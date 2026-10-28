/**
 * Test Set Importer
 *
 * Creates a Spira Test Set from a parsed Zephyr test cycle, resolves its
 * folder, and maps member test cases in their original cycle order.
 *
 * Ordering: the Spira "add test case mapping" endpoint cannot set Position,
 * so we add all members first, then re-read the mappings and PUT them back
 * with sequential Position values matching the Zephyr cycle order.
 */

import type { SpiraApiClient } from '../spira/client.js';
import type { Logger } from '../logger/index.js';
import type { TestSetFolder, TestSetTestCaseMapping } from '../types/import.js';
import type { ZephyrTestSet } from '../parser/zephyr-bundle.js';
import { createTestSetFolderResolver, type TestSetFolderResolver } from './test-set-folder-resolver.js';

// Default Spira Test Set status: "Not Started" (1). We are not importing
// execution history, so imported sets start clean and ready to run.
const DEFAULT_TEST_SET_STATUS_ID = 1;
// 1 = Manual test set (the Zephyr cycles we import are manual test execution).
const MANUAL_TEST_RUN_TYPE_ID = 1;

export interface TestSetImportConfig {
  client: SpiraApiClient;
  logger: Logger;
  existingTestSetFolders: TestSetFolder[];
  /** Optional root folder to nest the imported test set folder under */
  rootFolder?: string;
  /**
   * Optional shared folder resolver. When importing several test sets in one
   * run, pass a single resolver so folders created for one set are reused by
   * the next (avoids duplicate folders). If omitted, a resolver is created
   * from `existingTestSetFolders`.
   */
  folderResolver?: TestSetFolderResolver;
}

export interface TestSetImportInput {
  testSet: ZephyrTestSet;
  /**
   * Maps a Zephyr test case key (e.g. "PROJ-T94") to the created Spira
   * test case ID. Members not present here are skipped (with a warning).
   */
  keyToTestCaseId: Map<string, number>;
}

export interface TestSetImportResult {
  testSetId?: number;
  testSetName: string;
  membersAdded: number;
  membersSkipped: number;
  orderingApplied: boolean;
  foldersCreated: string[];
  warnings: string[];
  error?: string;
  /** Dry-run only: the ordered member keys that would be added */
  plannedMembers?: string[];
}

/**
 * Imports a single Zephyr test cycle as a Spira Test Set.
 */
export async function importTestSet(
  input: TestSetImportInput,
  config: TestSetImportConfig,
  options: { dryRun: boolean },
): Promise<TestSetImportResult> {
  const { testSet, keyToTestCaseId } = input;
  const { client, logger, existingTestSetFolders, rootFolder, folderResolver } = config;

  const result: TestSetImportResult = {
    testSetName: testSet.name,
    membersAdded: 0,
    membersSkipped: 0,
    orderingApplied: false,
    foldersCreated: [],
    warnings: [],
  };

  // Compose the folder path (apply root folder prefix if configured)
  let folderPath = testSet.folderPath ?? undefined;
  if (rootFolder) {
    folderPath = folderPath
      ? `${rootFolder}/${folderPath}`.replace(/\/+/g, '/')
      : rootFolder;
  }

  if (options.dryRun) {
    logger.info(`[dry-run] Would create Test Set "${testSet.name}"` +
      (folderPath ? ` in folder "${folderPath}"` : '') +
      ` with ${testSet.memberKeys.length} member(s).`);

    // Report the intended member order so it can be eyeballed before a live run.
    let position = 1;
    for (const key of testSet.memberKeys) {
      const resolvable = keyToTestCaseId.has(key);
      if (resolvable) {
        result.membersAdded++;
        logger.info(`[dry-run]   ${position}. ${key}`);
      } else {
        result.membersSkipped++;
        result.warnings.push(`Member "${key}" would be skipped (test case not imported).`);
      }
      position++;
    }
    result.orderingApplied = result.membersAdded > 1;
    result.plannedMembers = testSet.memberKeys.filter(k => keyToTestCaseId.has(k));
    result.warnings.unshift('Dry-run: no Test Set was created (plan shown above).');
    return result;
  }

  try {
    // 1. Resolve the test set folder. Reuse a shared resolver when provided so
    // folders created for an earlier set in the same run aren't recreated.
    let folderId: number | null = null;
    if (folderPath) {
      const resolver = folderResolver
        ?? createTestSetFolderResolver(client, existingTestSetFolders, logger, '/');
      const createdBefore = resolver.getCreatedFolders().length;
      folderId = await resolver.resolve(folderPath);
      // Report only folders this call actually created.
      result.foldersCreated = resolver.getCreatedFolders().slice(createdBefore);
    }

    // 2. Create the test set
    const description = buildDescription(testSet);
    const created = await client.createTestSet({
      Name: testSet.name,
      Description: description,
      TestSetStatusId: DEFAULT_TEST_SET_STATUS_ID,
      TestRunTypeId: MANUAL_TEST_RUN_TYPE_ID,
      TestSetFolderId: folderId ?? undefined,
    });
    result.testSetId = created.TestSetId;
    logger.info(`Created Test Set "${testSet.name}" (ID: ${created.TestSetId})`);

    // 3. Add member test cases in cycle order
    const orderedTestCaseIds: number[] = [];
    for (const key of testSet.memberKeys) {
      const testCaseId = keyToTestCaseId.get(key);
      if (testCaseId === undefined) {
        result.membersSkipped++;
        result.warnings.push(`Member "${key}" was not imported — skipped from Test Set.`);
        continue;
      }
      await client.addTestCaseToSet(created.TestSetId, testCaseId);
      orderedTestCaseIds.push(testCaseId);
      result.membersAdded++;
    }

    // 4. Apply ordering via PUT (Position could not be set during add)
    if (orderedTestCaseIds.length > 1) {
      result.orderingApplied = await applyOrdering(
        client,
        created.TestSetId,
        orderedTestCaseIds,
        logger,
        result.warnings,
      );
    }

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Test Set import failed: ${msg}`);
    result.error = msg;
    return result;
  }
}

/**
 * Sets the Position of each mapping to match the intended order.
 * Re-reads the current mappings (to obtain TestSetTestCaseId values),
 * assigns Position by the order of orderedTestCaseIds, then PUTs them back.
 */
async function applyOrdering(
  client: SpiraApiClient,
  testSetId: number,
  orderedTestCaseIds: number[],
  logger: Logger,
  warnings: string[],
): Promise<boolean> {
  const mappings = await client.getTestCaseMappings(testSetId);
  if (mappings.length === 0) {
    warnings.push('Could not read Test Set mappings to apply ordering.');
    return false;
  }

  // Build position lookup from the intended order.
  // If a test case appears more than once, later duplicates keep insertion order.
  const positionByTestCaseId = new Map<number, number>();
  orderedTestCaseIds.forEach((tcId, index) => {
    if (!positionByTestCaseId.has(tcId)) {
      positionByTestCaseId.set(tcId, index + 1); // Spira positions are 1-based
    }
  });

  // PUT each mapping individually (the endpoint takes a single object).
  // Spira ignores a Position change if that position is already in use, so we
  // update in descending target-position order to minimise transient collisions.
  const updates = mappings
    .map(m => ({ mapping: m, target: positionByTestCaseId.get(m.TestCaseId) ?? m.Position }))
    .filter(u => u.target !== undefined && u.target !== u.mapping.Position)
    .sort((a, b) => (b.target ?? 0) - (a.target ?? 0));

  if (updates.length === 0) {
    // Positions already match the intended order (members were added in order).
    logger.info('Test Set members already in the correct order — no reordering needed.');
    return true;
  }

  let applied = 0;
  for (const u of updates) {
    try {
      await client.updateTestCaseMapping(testSetId, { ...u.mapping, Position: u.target });
      applied++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not set position for test case ${u.mapping.TestCaseId}: ${msg}`);
    }
  }

  logger.info(`Applied execution order to ${applied} Test Set member(s).`);
  return applied > 0;
}

/**
 * Builds a Test Set description carrying Zephyr traceability info.
 */
function buildDescription(testSet: ZephyrTestSet): string {
  const parts: string[] = [`[Source cycle: ${testSet.key}]`];
  if (testSet.iteration) parts.push(`Iteration: ${testSet.iteration}`);
  if (testSet.plannedStartDate) parts.push(`Planned start: ${testSet.plannedStartDate.slice(0, 10)}`);
  if (testSet.plannedEndDate) parts.push(`Planned end: ${testSet.plannedEndDate.slice(0, 10)}`);
  if (testSet.status) parts.push(`Zephyr status: ${testSet.status}`);
  return parts.join(' | ');
}
