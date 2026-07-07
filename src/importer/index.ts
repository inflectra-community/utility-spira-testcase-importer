/**
 * Import Engine — orchestrates per-record test case injection into Spira
 * with progress tracking, resilient error handling, dry-run mode, and graceful shutdown.
 *
 * Per-record flow:
 *   1. Resolve folder path → TestCaseFolderId (via Folder Resolver)
 *   2. Create test case via Spira API
 *   3. Add test steps to the created test case
 *   4. Custom properties are set inline during test case creation
 *
 * Requirements: 7.1, 7.2, 7.4, 7.5, 7.6, 9.1, 9.4
 */

import type { SpiraApiClient } from '../spira/client.js';
import type { Logger } from '../logger/index.js';
import type { CustomPropertyDefinition, TestCaseFolder } from '../types/spira.js';
import type { TransformedTestCase } from '../types/transform.js';
import type {
  ImportResult,
  ImportFailure,
  CreateTestCaseRequest,
  CreateTestStepRequest,
} from '../types/import.js';
import { createFolderResolver, type FolderResolver } from './folder-resolver.js';
import { serializeCustomProperty } from '../transformer/custom-property-serializer.js';

/**
 * Progress callback invoked after each test case is processed.
 */
export type ProgressCallback = (current: number, total: number, item: string) => void;

/**
 * Options for the import engine.
 */
export interface ImportOptions {
  dryRun: boolean;
  onProgress: ProgressCallback;
}

/**
 * The ImportEngine interface as defined in the design document.
 */
export interface ImportEngine {
  import(
    testCases: TransformedTestCase[],
    options: ImportOptions,
  ): Promise<ImportResult>;
}

/**
 * Configuration required to create an ImportEngine instance.
 */
export interface ImportEngineConfig {
  client: SpiraApiClient;
  logger: Logger;
  existingFolders: TestCaseFolder[];
  customPropertyDefinitions: CustomPropertyDefinition[];
  pathSeparator?: string;
}

/**
 * Creates an ImportEngine instance.
 *
 * The engine:
 * - Resolves folder hierarchies before import using the FolderResolver
 * - Creates test cases one-by-one, logging failures but continuing with remaining
 * - Tracks success/failure counts and failure details
 * - Supports dry-run mode (no mutating API calls)
 * - Handles SIGINT/SIGTERM for graceful shutdown
 */
export function createImportEngine(config: ImportEngineConfig): ImportEngine {
  const { client, logger, existingFolders, customPropertyDefinitions, pathSeparator } = config;

  async function importTestCases(
    testCases: TransformedTestCase[],
    options: ImportOptions,
  ): Promise<ImportResult> {
    const { dryRun, onProgress } = options;
    const startTime = Date.now();

    const failures: ImportFailure[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Graceful shutdown state
    let shutdownRequested = false;
    let currentIndex = 0;

    const handleShutdown = () => {
      shutdownRequested = true;
      logger.warn('Shutdown signal received. Completing current request before exiting...');
    };

    // Register signal handlers
    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);

    // Create folder resolver
    const folderResolver: FolderResolver = createFolderResolver(
      client,
      existingFolders,
      logger,
      pathSeparator,
    );

    // Phase 1: Resolve all folder paths before importing test cases
    // (unless dry-run, in which case we skip folder creation)
    if (!dryRun) {
      const uniqueFolderPaths = new Set<string>();
      for (const tc of testCases) {
        if (tc.folderPath && tc.folderPath.trim() !== '') {
          uniqueFolderPaths.add(tc.folderPath.trim());
        }
      }

      if (uniqueFolderPaths.size > 0) {
        logger.info(`Resolving ${uniqueFolderPaths.size} unique folder path(s)...`);
        for (const folderPath of uniqueFolderPaths) {
          if (shutdownRequested) break;
          try {
            await folderResolver.resolve(folderPath);
          } catch (err) {
            // Folder resolution failure is logged but doesn't stop the import.
            // Test cases referencing this folder will fail individually.
            const errorMessage = err instanceof Error ? err.message : String(err);
            logger.error(`Failed to resolve folder "${folderPath}": ${errorMessage}`);
          }
        }
      }
    }

    // Phase 2: Import test cases one-by-one
    const total = testCases.length;
    logger.info(`Starting import of ${total} test case(s)${dryRun ? ' (dry-run mode)' : ''}...`);

    for (currentIndex = 0; currentIndex < total; currentIndex++) {
      // Check for shutdown before starting a new record
      if (shutdownRequested) {
        logger.warn(`Shutdown: stopping after ${currentIndex} of ${total} test cases.`);
        logInterruptionState(currentIndex, total, testCases, logger);
        break;
      }

      const testCase = testCases[currentIndex];
      onProgress(currentIndex + 1, total, testCase.name);

      if (dryRun) {
        // In dry-run mode: validate/transform only, no API calls
        logger.info(`[DRY-RUN] Would import: "${testCase.name}" (row ${testCase.sourceRowIndex})`);
        successCount++;
        continue;
      }

      try {
        await importSingleTestCase(testCase, folderResolver, client, customPropertyDefinitions, logger);
        successCount++;
      } catch (err) {
        failureCount++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        const phase = determineFailurePhase(err);

        const failure: ImportFailure = {
          sourceRowIndex: testCase.sourceRowIndex,
          testCaseName: testCase.name,
          error: errorMessage,
          phase,
        };

        failures.push(failure);
        logger.error(`Failed to import "${testCase.name}" (row ${testCase.sourceRowIndex}): ${errorMessage}`, {
          phase,
          sourceRowIndex: testCase.sourceRowIndex,
        });
      }
    }

    // Unregister signal handlers
    process.removeListener('SIGINT', handleShutdown);
    process.removeListener('SIGTERM', handleShutdown);

    const duration = Date.now() - startTime;
    const createdFolders = folderResolver.getCreatedFolders();

    const result: ImportResult = {
      totalAttempted: currentIndex,
      successCount,
      failureCount,
      failures,
      createdFolders,
      duration,
    };

    logger.info(`Import complete: ${successCount} succeeded, ${failureCount} failed, ${total - currentIndex} skipped (${duration}ms)`);

    // If shutdown was requested, persist log before exiting
    if (shutdownRequested) {
      await logger.persist();
      process.exit(1);
    }

    return result;
  }

  return {
    import: importTestCases,
  };
}

/**
 * Imports a single test case: resolve folder, create test case, add test steps.
 * Custom properties are included in the test case creation request.
 */
async function importSingleTestCase(
  testCase: TransformedTestCase,
  folderResolver: FolderResolver,
  client: SpiraApiClient,
  customPropertyDefinitions: CustomPropertyDefinition[],
  logger: Logger,
): Promise<void> {
  // Step 1: Resolve folder path to ID
  let folderId: number | null = null;
  try {
    folderId = await folderResolver.resolve(testCase.folderPath);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new ImportPhaseError(`Folder resolution failed: ${errorMessage}`, 'folder');
  }

  // Step 2: Build and create the test case
  const request = buildTestCaseRequest(testCase, folderId, customPropertyDefinitions);

  let testCaseId: number;
  try {
    const response = await client.createTestCase(request);
    testCaseId = response.TestCaseId;
    logger.info(`Created test case "${testCase.name}" (ID: ${testCaseId})`, {
      sourceRowIndex: testCase.sourceRowIndex,
      testCaseId,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new ImportPhaseError(`Test case creation failed: ${errorMessage}`, 'testcase');
  }

  // Step 3: Add test steps if present
  if (testCase.testSteps.length > 0) {
    const steps: CreateTestStepRequest[] = testCase.testSteps.map((step) => ({
      Description: step.description,
      ExpectedResult: step.expectedResult,
      SampleData: step.sampleData,
      Position: step.position,
    }));

    try {
      await client.addTestSteps(testCaseId, steps);
      logger.info(`Added ${steps.length} test step(s) to test case ${testCaseId}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new ImportPhaseError(`Test step creation failed: ${errorMessage}`, 'teststep');
    }
  }
}

/**
 * Builds the CreateTestCaseRequest from a TransformedTestCase.
 */
function buildTestCaseRequest(
  testCase: TransformedTestCase,
  folderId: number | null,
  customPropertyDefinitions: CustomPropertyDefinition[],
): CreateTestCaseRequest {
  const request: CreateTestCaseRequest = {
    Name: testCase.name,
    TestCaseStatusId: testCase.testCaseStatusId ?? 0,
  };

  if (testCase.description !== undefined) {
    request.Description = testCase.description;
  }

  if (testCase.testCaseTypeId !== undefined) {
    request.TestCaseTypeId = testCase.testCaseTypeId;
  }

  if (testCase.testCasePriorityId !== undefined) {
    request.TestCasePriorityId = testCase.testCasePriorityId;
  }

  if (testCase.ownerId !== undefined) {
    request.OwnerId = testCase.ownerId;
  }

  if (folderId !== null) {
    request.TestCaseFolderId = folderId;
  }

  if (testCase.componentIds !== undefined && testCase.componentIds.length > 0) {
    request.ComponentIds = testCase.componentIds;
  }

  if (testCase.tags !== undefined) {
    request.Tags = testCase.tags;
  }

  // Serialize custom properties
  if (testCase.customProperties.length > 0) {
    const defsByNumber = new Map(
      customPropertyDefinitions.map((d) => [d.propertyNumber, d]),
    );

    request.CustomProperties = testCase.customProperties
      .map((cp) => {
        const definition = defsByNumber.get(cp.propertyNumber);
        if (!definition) {
          // Skip unknown custom properties — shouldn't happen after validation
          return null;
        }
        return serializeCustomProperty(cp, definition);
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }

  return request;
}

/**
 * Error subclass that tracks which import phase failed.
 */
class ImportPhaseError extends Error {
  constructor(
    message: string,
    public readonly phase: 'folder' | 'testcase' | 'teststep',
  ) {
    super(message);
    this.name = 'ImportPhaseError';
  }
}

/**
 * Determines the failure phase from an error.
 */
function determineFailurePhase(err: unknown): 'folder' | 'testcase' | 'teststep' {
  if (err instanceof ImportPhaseError) {
    return err.phase;
  }
  return 'testcase'; // Default to testcase phase for unexpected errors
}

/**
 * Logs the interruption state showing which items were processed and which remain.
 */
function logInterruptionState(
  processedUpTo: number,
  total: number,
  testCases: TransformedTestCase[],
  logger: Logger,
): void {
  const processed = testCases.slice(0, processedUpTo).map((tc) => ({
    sourceRowIndex: tc.sourceRowIndex,
    name: tc.name,
  }));

  const remaining = testCases.slice(processedUpTo).map((tc) => ({
    sourceRowIndex: tc.sourceRowIndex,
    name: tc.name,
  }));

  logger.info('Interruption state:', {
    processedCount: processedUpTo,
    remainingCount: total - processedUpTo,
    processed,
    remaining,
  });
}
