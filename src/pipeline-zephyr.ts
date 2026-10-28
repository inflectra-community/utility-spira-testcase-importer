/**
 * Zephyr Bundle Pipeline
 *
 * A streamlined pipeline path for importing Zephyr Scale JSON bundles.
 * Skips heuristics/LLM entirely — the data is already structured.
 *
 * Flow:
 *   Phase 1: Authenticate against Spira + fetch metadata
 *   Phase 2: Parse Zephyr bundle → TransformedTestCase[]
 *   Phase 3: Resolve Zephyr names (priority, status, component, custom properties) to Spira IDs
 *   Phase 4: Validate
 *   Phase 5: User approval
 *   Phase 6: Import (folders + test cases + test steps)
 *   Phase 7: Upload inline image attachments
 *   Phase 8: Summary + persist log
 */

import { select } from '@inquirer/prompts';
import * as path from 'node:path';
import type { ImporterConfig } from './types/config.js';
import type { Logger } from './logger/index.js';
import type { TemplateMetadata } from './types/spira.js';
import type { TransformedTestCase } from './types/transform.js';
import { createSpiraClient } from './spira/client.js';
import { fetchAllMetadata } from './spira/metadata.js';
import { createValidationEngine } from './validator/index.js';
import { createImportEngine } from './importer/index.js';
import { parseZephyrBundle, type ZephyrBundleResult, type ZephyrAttachmentRef } from './parser/zephyr-bundle.js';
import { uploadAttachments, type PendingAttachment } from './importer/attachment-handler.js';
import { importTestSet, type TestSetImportResult } from './importer/test-set-importer.js';
import { createTestSetFolderResolver } from './importer/test-set-folder-resolver.js';

/**
 * Runs the Zephyr bundle import pipeline.
 */
export async function runZephyrPipeline(
  config: ImporterConfig,
  logger: Logger,
): Promise<void> {
  // ANSI codes
  const DIM = '\x1b[2m';
  const BOLD = '\x1b[1m';
  const CYAN = '\x1b[36m';
  const GREEN = '\x1b[32m';
  const YELLOW = '\x1b[33m';
  const RED = '\x1b[31m';
  const RESET = '\x1b[0m';

  // Configuration banner
  process.stdout.write(`\n${CYAN}${BOLD}─── Spira Import (Zephyr Bundle) ───${RESET}\n`);
  process.stdout.write(`  ${BOLD}Spira URL:${RESET}     ${config.spira.baseUrl}\n`);
  process.stdout.write(`  ${BOLD}Project ID:${RESET}    ${config.spira.projectId}\n`);
  process.stdout.write(`  ${BOLD}Username:${RESET}      ${config.spira.username}\n`);
  process.stdout.write(`  ${BOLD}API Key:${RESET}       ${DIM}(hidden)${RESET}\n`);
  process.stdout.write(`  ${BOLD}Source:${RESET}        ${config.sourceFile} ${DIM}(Zephyr Scale bundle)${RESET}\n`);
  process.stdout.write(`  ${BOLD}Dry Run:${RESET}       ${config.dryRun ? 'Yes' : 'No'}\n`);
  if (config.rootFolder) {
    process.stdout.write(`  ${BOLD}Root Folder:${RESET}   ${config.rootFolder}\n`);
  }
  process.stdout.write(`${CYAN}${'─'.repeat(37)}${RESET}\n\n`);

  // Phase 1: Connect & Authenticate
  logger.info('Phase 1: Connecting to Spira...');
  const spiraClient = createSpiraClient(config.spira, logger);
  await spiraClient.authenticate();

  // Phase 1b: Retrieve Template Metadata
  logger.info('Phase 1b: Retrieving template metadata...');
  const metadataResult = await fetchAllMetadata(spiraClient, config.spira, 0, logger);
  const metadata: TemplateMetadata = metadataResult.metadata;
  if (metadataResult.failures.length > 0) {
    logger.warn(`Some metadata could not be retrieved: ${metadataResult.failures.map(f => f.field).join(', ')}`);
  }
  logger.info(`Retrieved metadata: ${metadata.customProperties.length} custom properties, ` +
    `${metadata.priorities.length} priorities, ${metadata.statuses.length} statuses`);

  // Phase 2: Parse Zephyr Bundle
  logger.info('Phase 2: Parsing Zephyr Scale bundle...');
  const bundleResult: ZephyrBundleResult = parseZephyrBundle(config.sourceFile);
  logger.info(`Parsed ${bundleResult.testCases.length} test case(s) from bundle.`);

  if (bundleResult.manifest) {
    process.stdout.write(`${DIM}${bundleResult.manifest.trim()}${RESET}\n\n`);
  }

  if (bundleResult.testCases.length === 0) {
    logger.error('No test cases found in bundle.');
    process.stderr.write('\n❌ The bundle contains no test cases. Nothing to import.\n');
    return;
  }

  // Capture Zephyr key → sourceRowIndex BEFORE resolution (which deletes _zephyrMeta).
  // Needed to link test set members to their created Spira test case IDs later.
  const keyToRowIndex = new Map<string, number>();
  for (const tc of bundleResult.testCases) {
    const key = (tc as any)._zephyrMeta?.key as string | undefined;
    if (key) keyToRowIndex.set(key, tc.sourceRowIndex);
  }

  // Phase 3: Resolve Zephyr names to Spira IDs
  logger.info('Phase 3: Resolving Zephyr field values to Spira IDs...');
  const resolutionWarnings = resolveZephyrMetadata(bundleResult.testCases, metadata);
  for (const warn of resolutionWarnings) {
    logger.warn(warn);
  }

  // Apply root folder prefix if configured
  if (config.rootFolder) {
    for (const tc of bundleResult.testCases) {
      if (tc.folderPath) {
        tc.folderPath = `${config.rootFolder}/${tc.folderPath}`.replace(/\/+/g, '/');
      } else {
        tc.folderPath = config.rootFolder;
      }
    }
    logger.info(`Root folder: "${config.rootFolder}" — all test cases will be imported under this folder.`);
  }

  // Phase 4: Validate
  logger.info('Phase 4: Validating transformed data...');
  const validator = createValidationEngine();
  const validationResult = validator.validate(bundleResult.testCases, metadata);
  logger.info(`Validation: ${validationResult.stats.validTestCases}/${validationResult.stats.totalTestCases} valid, ` +
    `${validationResult.stats.errorCount} errors, ${validationResult.stats.warningCount} warnings`);

  // Display summary
  process.stdout.write(`\n${CYAN}${BOLD}┌─────────────────────────────────────────────────────────────┐${RESET}\n`);
  process.stdout.write(`${CYAN}${BOLD}│  Zephyr Bundle Import Summary                               │${RESET}\n`);
  process.stdout.write(`${CYAN}├─────────────────────────────────────────────────────────────┤${RESET}\n`);
  process.stdout.write(`│  Test cases:        ${BOLD}${bundleResult.testCases.length}${RESET}\n`);
  process.stdout.write(`│  Total test steps:  ${BOLD}${bundleResult.testCases.reduce((sum, tc) => sum + tc.testSteps.length, 0)}${RESET}\n`);
  process.stdout.write(`│  Inline images:     ${BOLD}${bundleResult.pendingAttachments.length}${RESET}\n`);
  if (bundleResult.testSets.length === 1) {
    const ts = bundleResult.testSets[0];
    process.stdout.write(`│  Test set:          ${BOLD}${ts.name.slice(0, 40)}${RESET} ${DIM}(${ts.memberKeys.length} members)${RESET}\n`);
  } else if (bundleResult.testSets.length > 1) {
    process.stdout.write(`│  Test sets:         ${BOLD}${bundleResult.testSets.length}${RESET} ${DIM}(one per cycle)${RESET}\n`);
  }
  process.stdout.write(`│  Validation:        ${validationResult.isValid ? GREEN + 'PASS' : RED + validationResult.stats.errorCount + ' errors'}${RESET}\n`);

  if (resolutionWarnings.length > 0) {
    process.stdout.write(`│  Warnings:          ${YELLOW}${resolutionWarnings.length}${RESET}\n`);
    for (const w of resolutionWarnings.slice(0, 5)) {
      process.stdout.write(`│    ${DIM}${w.slice(0, 55)}${RESET}\n`);
    }
    if (resolutionWarnings.length > 5) {
      process.stdout.write(`│    ${DIM}... and ${resolutionWarnings.length - 5} more${RESET}\n`);
    }
  }

  // List test cases
  process.stdout.write(`${CYAN}├─────────────────────────────────────────────────────────────┤${RESET}\n`);
  for (const tc of bundleResult.testCases) {
    const meta = (tc as any)._zephyrMeta;
    const key = meta?.key ?? '?';
    const steps = tc.testSteps.length;
    process.stdout.write(`│  ${GREEN}${key}${RESET}  ${tc.name.slice(0, 40)}${tc.name.length > 40 ? '...' : ''} ${DIM}(${steps} steps)${RESET}\n`);
  }
  process.stdout.write(`${CYAN}${BOLD}└─────────────────────────────────────────────────────────────┘${RESET}\n\n`);

  // Phase 5: Approval
  const approvalChoice = await select({
    message: validationResult.isValid
      ? `Import ${bundleResult.testCases.length} test cases?`
      : `There are ${validationResult.stats.errorCount} validation errors. Proceed anyway?`,
    choices: [
      { name: config.dryRun ? 'Proceed (dry-run mode)' : 'Proceed with import', value: 'proceed' },
      { name: 'Abort import', value: 'abort' },
    ],
  });

  if (approvalChoice === 'abort') {
    logger.info('Import aborted by user.');
    process.stdout.write('\nImport aborted.\n');
    await logger.persist(config.logFile);
    return;
  }

  // Phase 6: Import
  if (config.dryRun) {
    logger.info('Dry-run mode: skipping actual import.');
    process.stdout.write('\n🔍 DRY-RUN MODE: No data was sent to Spira.\n');
  }

  logger.info(`Phase 6: ${config.dryRun ? 'Dry-run' : 'Importing'} ${bundleResult.testCases.length} test cases...`);

  const importEngine = createImportEngine({
    client: spiraClient,
    logger,
    customPropertyDefinitions: metadata.customProperties,
    existingFolders: metadata.existingFolders,
    pathSeparator: '/',
  });

  const importResult = await importEngine.import(bundleResult.testCases, {
    dryRun: config.dryRun,
    onProgress: (current, total, item) => {
      process.stdout.write(`\r  [${current}/${total}] ${item}`);
    },
  });

  process.stdout.write('\n\n');

  // Phase 7: Upload inline image attachments
  if (!config.dryRun && bundleResult.pendingAttachments.length > 0 && importResult.createdTestCases.size > 0) {
    logger.info(`Phase 7: Uploading ${bundleResult.pendingAttachments.length} inline image(s)...`);

    const pendingUploads: PendingAttachment[] = [];
    for (const ref of bundleResult.pendingAttachments) {
      const testCaseId = importResult.createdTestCases.get(ref.testCaseIndex);
      if (!testCaseId) continue;

      pendingUploads.push({
        testCaseId,
        sourceRowIndex: ref.testCaseIndex,
        filename: path.basename(ref.localPath),
        filePath: ref.localPath,
      });
    }

    if (pendingUploads.length > 0) {
      const attachResult = await uploadAttachments(pendingUploads, {
        client: spiraClient,
        logger,
        projectId: config.spira.projectId,
        baseDir: process.cwd(),
      });
      process.stdout.write(`  Attachments: ${attachResult.successCount} uploaded, ${attachResult.skippedCount} skipped, ${attachResult.failureCount} failed\n`);
    }
  }

  // Phase 7.5: Create Test Sets from the Zephyr cycle(s). A nested-format
  // project may contain several cycles; each becomes its own Spira Test Set.
  const testSetResults: TestSetImportResult[] = [];
  if (bundleResult.testSets.length > 0) {
    // Build Zephyr key → created Spira test case ID.
    // In dry-run no test cases are created, so use the row index as a placeholder
    // ID purely to let the planner show which members (and order) would be mapped.
    const keyToTestCaseId = new Map<string, number>();
    for (const [key, rowIndex] of keyToRowIndex) {
      if (config.dryRun) {
        keyToTestCaseId.set(key, rowIndex); // placeholder — not a real Spira ID
      } else {
        const testCaseId = importResult.createdTestCases.get(rowIndex);
        if (testCaseId !== undefined) {
          keyToTestCaseId.set(key, testCaseId);
        }
      }
    }

    const existingTestSetFolders = config.dryRun ? [] : await spiraClient.getTestSetFolders();
    // Share one folder resolver across all sets so a shared folder path isn't
    // recreated for each cycle.
    const sharedFolderResolver = config.dryRun
      ? undefined
      : createTestSetFolderResolver(spiraClient, existingTestSetFolders, logger, '/');

    logger.info(`Phase 7.5: Creating ${bundleResult.testSets.length} Test Set(s)...`);

    for (const testSet of bundleResult.testSets) {
      const testSetResult = await importTestSet(
        { testSet, keyToTestCaseId },
        {
          client: spiraClient,
          logger,
          existingTestSetFolders,
          rootFolder: config.rootFolder,
          folderResolver: sharedFolderResolver,
        },
        { dryRun: config.dryRun },
      );
      testSetResults.push(testSetResult);

      for (const w of testSetResult.warnings) logger.warn(w);
      if (testSetResult.error) {
        process.stdout.write(`  ${RED}Test Set "${testSetResult.testSetName}" failed: ${testSetResult.error}${RESET}\n`);
      } else if (config.dryRun) {
        process.stdout.write(`  ${DIM}Would create Test Set:${RESET} "${testSetResult.testSetName}"\n`);
        const members = testSetResult.plannedMembers ?? [];
        members.forEach((key, i) => {
          process.stdout.write(`    ${DIM}${i + 1}. ${key}${RESET}\n`);
        });
        if (testSetResult.membersSkipped > 0) {
          process.stdout.write(`    ${YELLOW}${testSetResult.membersSkipped} member(s) would be skipped${RESET}\n`);
        }
      } else {
        process.stdout.write(`  Test Set: "${testSetResult.testSetName}" created ` +
          `(${testSetResult.membersAdded} members` +
          `${testSetResult.membersSkipped > 0 ? `, ${testSetResult.membersSkipped} skipped` : ''}` +
          `${testSetResult.orderingApplied ? ', ordered' : ''})\n`);
      }
    }
  }

  // Phase 8: Summary
  const mode = config.dryRun ? 'DRY-RUN ' : '';
  process.stdout.write(`${CYAN}${BOLD}${'='.repeat(63)}${RESET}\n`);
  process.stdout.write(`  ${BOLD}${mode}Import Summary (Zephyr Bundle)${RESET}\n`);
  process.stdout.write(`${CYAN}${BOLD}${'='.repeat(63)}${RESET}\n`);
  process.stdout.write(`  Total attempted:  ${BOLD}${importResult.totalAttempted}${RESET}\n`);
  process.stdout.write(`  Successful:       ${GREEN}${BOLD}${importResult.successCount}${RESET}\n`);
  process.stdout.write(`  Failed:           ${importResult.failureCount > 0 ? RED + BOLD : DIM}${importResult.failureCount}${RESET}\n`);
  process.stdout.write(`  Folders created:  ${importResult.createdFolders.length}\n`);
  const createdSets = testSetResults.filter(r => !r.error);
  if (createdSets.length === 1) {
    const r = createdSets[0];
    process.stdout.write(`  Test set:         ${GREEN}${BOLD}${r.membersAdded}${RESET} member(s)${r.orderingApplied ? ' (ordered)' : ''}\n`);
  } else if (createdSets.length > 1) {
    const totalMembers = createdSets.reduce((n, r) => n + r.membersAdded, 0);
    process.stdout.write(`  Test sets:        ${GREEN}${BOLD}${createdSets.length}${RESET} (${totalMembers} member(s) total)\n`);
  }
  process.stdout.write(`  Duration:         ${(importResult.duration / 1000).toFixed(1)}s\n`);

  if (importResult.failures.length > 0) {
    process.stdout.write(`\n  ${RED}${BOLD}Failures:${RESET}\n`);
    for (const f of importResult.failures.slice(0, 10)) {
      process.stdout.write(`    ${RED}x${RESET} "${f.testCaseName}": ${DIM}${f.error}${RESET}\n`);
    }
    if (importResult.failures.length > 10) {
      process.stdout.write(`    ${DIM}... and ${importResult.failures.length - 10} more (see log file)${RESET}\n`);
    }
  }

  process.stdout.write(`${CYAN}${BOLD}${'='.repeat(63)}${RESET}\n`);

  await logger.persist(config.logFile);
  logger.info(`Log persisted to: ${config.logFile ?? 'import-log-<timestamp>.json'}`);
}

// --- Internal: Name-to-ID resolution ---

/**
 * Fuzzy name matching for resolving source values to Spira entries.
 * Cascading strategy:
 *   1. Exact match (case-insensitive)
 *   2. Contains match — target name contains source value (e.g. "2 - High" contains "High")
 *   3. Source contains target — source value contains target name stripped of prefix
 *   4. Numeric prefix strip — remove "1 - ", "2 - " etc. and compare remainder
 *
 * Returns the first match found, or undefined if nothing matches.
 */
export function fuzzyMatchName<T>(
  sourceValue: string,
  candidates: T[],
  getName: (item: T) => string,
  isActive?: (item: T) => boolean,
): T | undefined {
  const source = sourceValue.toLowerCase().trim();

  // Filter to active only if predicate provided
  const pool = isActive ? candidates.filter(isActive) : candidates;

  // 1. Exact match
  const exact = pool.find(c => getName(c).toLowerCase().trim() === source);
  if (exact) return exact;

  // 2. Target contains source (e.g. "2 - High" contains "High")
  const containsMatch = pool.find(c => getName(c).toLowerCase().includes(source));
  if (containsMatch) return containsMatch;

  // 3. Source contains target (e.g. "Country Code" contains "Country")
  const sourceContainsTarget = pool.find(c => {
    const target = getName(c).toLowerCase().trim();
    return target.length >= 3 && source.includes(target);
  });
  if (sourceContainsTarget) return sourceContainsTarget;

  // 4. Strip common suffixes ("Code", "ID", "Name", "Value") from source and compare
  const stripSuffix = (s: string) => s.replace(/\s*(code|id|name|value|number|num|no)$/i, '').trim().toLowerCase();
  const strippedSource = stripSuffix(sourceValue);
  if (strippedSource !== source) {
    const suffixMatch = pool.find(c => getName(c).toLowerCase().trim() === strippedSource);
    if (suffixMatch) return suffixMatch;
  }

  // 5. Strip numeric prefix pattern "N - " from target and compare
  const stripPrefix = (s: string) => s.replace(/^\d+\s*[-–—]\s*/, '').toLowerCase().trim();
  const strippedMatch = pool.find(c => stripPrefix(getName(c)) === source);
  if (strippedMatch) return strippedMatch;

  // 6. Source contains stripped target
  const reverseContains = pool.find(c => {
    const stripped = stripPrefix(getName(c));
    return stripped.length >= 3 && source.includes(stripped);
  });
  if (reverseContains) return reverseContains;

  return undefined;
}

/**
 * Resolves Zephyr name-based values (priority, status, component, custom properties)
 * to Spira numeric IDs using the template metadata.
 *
 * Uses fuzzy matching (contains, prefix-strip) to handle naming differences
 * between Zephyr ("High") and Spira ("2 - High").
 *
 * Mutates testCases in-place. Returns an array of warning messages for unresolved values.
 */
export function resolveZephyrMetadata(
  testCases: TransformedTestCase[],
  metadata: TemplateMetadata,
): string[] {
  const warnings: string[] = [];

  for (const tc of testCases) {
    const meta = (tc as any)._zephyrMeta as {
      priority?: string;
      status?: string;
      component?: string;
      key?: string;
    } | undefined;

    if (!meta) continue;

    // Resolve priority by name (fuzzy)
    if (meta.priority) {
      const match = fuzzyMatchName(
        meta.priority,
        metadata.priorities,
        p => p.name,
        p => p.active,
      );
      if (match) {
        tc.testCasePriorityId = match.priorityId;
      } else {
        warnings.push(`[${meta.key}] Priority "${meta.priority}" not found in Spira template`);
      }
    }

    // Resolve status by name (fuzzy)
    if (meta.status) {
      const match = fuzzyMatchName(
        meta.status,
        metadata.statuses,
        s => s.name,
        s => s.active,
      );
      if (match) {
        tc.testCaseStatusId = match.testCaseStatusId;
      } else {
        warnings.push(`[${meta.key}] Status "${meta.status}" not found in Spira template`);
      }
    }

    // Resolve component by name (fuzzy)
    if (meta.component) {
      const match = fuzzyMatchName(
        meta.component,
        metadata.components,
        c => c.name,
        c => c.active,
      );
      if (match) {
        tc.componentIds = [match.componentId];
      } else {
        warnings.push(`[${meta.key}] Component "${meta.component}" not found in Spira template`);
      }
    }

    // Resolve custom properties by name
    if (tc.customProperties.length > 0) {
      const resolvedCPs: typeof tc.customProperties = [];

      for (const cp of tc.customProperties) {
        const cpWithName = cp as any;
        const cpName: string | undefined = cpWithName.name;

        if (!cpName) {
          resolvedCPs.push(cp);
          continue;
        }

        // Find the custom property definition by name (fuzzy)
        const cpDef = fuzzyMatchName(
          cpName,
          metadata.customProperties,
          d => d.name,
        );

        if (!cpDef) {
          warnings.push(`[${meta.key}] Custom property "${cpName}" not found in Spira template`);
          continue;
        }

        // For list types, resolve the value to an ID (fuzzy)
        if (cpDef.customPropertyTypeId === 6 && cpDef.customListId) {
          const listValues = metadata.customLists.get(cpDef.customListId);
          const valueMatch = listValues
            ? fuzzyMatchName(String(cp.value), listValues, v => v.name, v => v.active)
            : undefined;
          if (valueMatch) {
            resolvedCPs.push({
              propertyNumber: cpDef.propertyNumber,
              value: valueMatch.customPropertyValueId,
            });
          } else {
            warnings.push(`[${meta.key}] Custom property "${cpName}" value "${cp.value}" not in list`);
            // Still store as text fallback if the property allows
            resolvedCPs.push({
              propertyNumber: cpDef.propertyNumber,
              value: cp.value,
            });
          }
        } else {
          // Text, integer, etc. — store directly
          resolvedCPs.push({
            propertyNumber: cpDef.propertyNumber,
            value: cp.value,
          });
        }
      }

      tc.customProperties = resolvedCPs;
    }

    // Clean up internal metadata
    delete (tc as any)._zephyrMeta;
  }

  return warnings;
}

// --- Exported: Zephyr gap analysis for SpiraProvisioner export ---

/**
 * A new custom property the Zephyr data references but the template lacks,
 * together with the values seen for it (used to infer list-vs-text + seed a list).
 */
export interface ZephyrNewProperty {
  name: string;
  /** Distinct non-empty values observed across all test cases */
  uniqueValues: string[];
  /** How many test cases carried a value for this property */
  rowCount: number;
}

/**
 * An existing list-type custom property that is missing some of the values the
 * Zephyr data uses.
 */
export interface ZephyrMissingListValues {
  propertyName: string;
  existingValues: string[];
  missingValues: string[];
}

export interface ZephyrGapAnalysis {
  newProperties: ZephyrNewProperty[];
  missingListValues: ZephyrMissingListValues[];
  /** Priority/status/component names not found — informational only (not provisionable as custom fields) */
  unprovisionableLookups: string[];
}

/**
 * Inspects a freshly-parsed Zephyr bundle against the template metadata and
 * collects the structural gaps, WITHOUT mutating the test cases.
 *
 * Must be called BEFORE resolveZephyrMetadata(), while test cases still carry
 * their `_zephyrMeta` and named custom properties.
 *
 * Mirrors the matching logic in resolveZephyrMetadata so the gaps reported here
 * are exactly the ones resolution would warn about.
 */
export function analyzeZephyrGaps(
  testCases: TransformedTestCase[],
  metadata: TemplateMetadata,
): ZephyrGapAnalysis {
  // Accumulate, per unmatched CP name, the set of values seen.
  const newProps = new Map<string, Set<string>>();
  // Per existing list CP name, the set of values seen that aren't in the list.
  const missingByProp = new Map<string, { def: typeof metadata.customProperties[number]; missing: Set<string> }>();
  const unprovisionable = new Set<string>();

  for (const tc of testCases) {
    const meta = (tc as any)._zephyrMeta as { priority?: string; status?: string; component?: string } | undefined;

    // Priority / status / component gaps — not provisionable as custom fields.
    if (meta?.priority && !fuzzyMatchName(meta.priority, metadata.priorities, p => p.name, p => p.active)) {
      unprovisionable.add(`Priority: ${meta.priority}`);
    }
    if (meta?.status && !fuzzyMatchName(meta.status, metadata.statuses, s => s.name, s => s.active)) {
      unprovisionable.add(`Status: ${meta.status}`);
    }
    if (meta?.component && !fuzzyMatchName(meta.component, metadata.components, c => c.name, c => c.active)) {
      unprovisionable.add(`Component: ${meta.component}`);
    }

    for (const cp of tc.customProperties) {
      const cpName: string | undefined = (cp as any).name;
      if (!cpName) continue;
      const value = cp.value != null ? String(cp.value).trim() : '';

      const cpDef = fuzzyMatchName(cpName, metadata.customProperties, d => d.name);
      if (!cpDef) {
        // New property — accumulate its values.
        if (!newProps.has(cpName)) newProps.set(cpName, new Set());
        if (value) newProps.get(cpName)!.add(value);
        continue;
      }

      // Existing list property — check whether the value is in the list.
      if (cpDef.customPropertyTypeId === 6 && cpDef.customListId && value) {
        const listValues = metadata.customLists.get(cpDef.customListId);
        const inList = listValues && fuzzyMatchName(value, listValues, v => v.name, v => v.active);
        if (!inList) {
          if (!missingByProp.has(cpDef.name)) {
            missingByProp.set(cpDef.name, { def: cpDef, missing: new Set() });
          }
          missingByProp.get(cpDef.name)!.missing.add(value);
        }
      }
    }
  }

  const newProperties: ZephyrNewProperty[] = [...newProps.entries()].map(([name, values]) => ({
    name,
    uniqueValues: [...values],
    rowCount: values.size,
  }));

  const missingListValues: ZephyrMissingListValues[] = [...missingByProp.values()].map(({ def, missing }) => {
    const listValues = def.customListId ? metadata.customLists.get(def.customListId) ?? [] : [];
    return {
      propertyName: def.name,
      existingValues: listValues.map(v => v.name),
      missingValues: [...missing],
    };
  });

  return { newProperties, missingListValues, unprovisionableLookups: [...unprovisionable] };
}
