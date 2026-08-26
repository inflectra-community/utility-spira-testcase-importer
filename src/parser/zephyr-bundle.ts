/**
 * Zephyr Scale JSON Bundle Parser
 *
 * Parses a Zephyr Scale test cycle export bundle (directory containing testcases/*.json)
 * and maps directly to TransformedTestCase[] — no heuristics or LLM needed.
 *
 * Bundle structure expected:
 *   <bundleDir>/
 *     testcases/         - One JSON file per test case (e.g. JBPT-T94.json)
 *     attachments/
 *       inline/          - Inline images referenced in step HTML
 *         _map.json      - Maps attachment IDs to local filenames
 *     issues/            - Linked Jira issues (not imported as test cases)
 *     MANIFEST.txt       - Bundle metadata
 *     checksums.txt      - Integrity checksums
 *
 * Field mapping:
 *   name           → TestCase.Name
 *   key            → stored as description prefix "[JBPT-T94]"
 *   status         → (mapped to Spira status by name at import time)
 *   priority       → (mapped to Spira priority by name at import time)
 *   component      → (mapped to Spira component by name at import time)
 *   folder         → TestCase.folderPath (already "/" separated)
 *   customFields   → custom properties by name
 *   testScript.steps[] → TestSteps (description, expectedResult, testData)
 *   labels         → Tags (joined with ",")
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TransformedTestCase, TransformedTestStep } from '../types/transform.js';

// --- Zephyr JSON types (what we read from disk) ---

interface ZephyrStep {
  index: number;
  description?: string;
  expectedResult?: string;
  testData?: string;
  id: number;
}

interface ZephyrTestScript {
  id: number;
  type: string;
  steps: ZephyrStep[];
}

interface ZephyrTestCase {
  key: string;
  name: string;
  status?: string;
  priority?: string;
  component?: string;
  folder?: string;
  labels?: string[];
  customFields?: Record<string, string>;
  testScript?: ZephyrTestScript;
  owner?: string;
  createdBy?: string;
  createdOn?: string;
  updatedOn?: string;
  // Fields we don't currently map but preserve awareness of:
  projectKey?: string;
  majorVersion?: number;
  latestVersion?: boolean;
  lastTestResultStatus?: string;
  parameters?: unknown;
}

// --- Test Cycle (Test Set) types ---

interface ZephyrCycleItem {
  testCaseKey: string;
  id?: number;
  status?: string;
  assignedTo?: string;
  executedBy?: string;
  executionDate?: string;
}

interface ZephyrTestCycle {
  key: string;
  name: string;
  status?: string;
  folder?: string;
  iteration?: string;
  plannedStartDate?: string;
  plannedEndDate?: string;
  testCaseCount?: number;
  createdBy?: string;
  items?: ZephyrCycleItem[];
}

// --- Inline image map ---

type AttachmentMap = Record<string, string>; // { "85154": "85154.png" }

// --- Public API ---

export interface ZephyrBundleResult {
  testCases: TransformedTestCase[];
  /** Paths to inline image files that need uploading post-import */
  pendingAttachments: ZephyrAttachmentRef[];
  /** Bundle metadata from MANIFEST.txt (informational) */
  manifest?: string;
  /** Test set (from testcycle/*.json), if present */
  testSet?: ZephyrTestSet;
}

/**
 * A Zephyr test cycle mapped to a Spira Test Set candidate.
 * Member ordering is preserved from the cycle's items[] array.
 */
export interface ZephyrTestSet {
  /** Zephyr cycle key, e.g. "JBPT-C3730" */
  key: string;
  /** Cycle name → Test Set name */
  name: string;
  /** Folder path (e.g. "/DE/E2E/O2C/O2C_aATP") → Test Set folder */
  folderPath?: string;
  /** Zephyr status (informational) */
  status?: string;
  /** Iteration label (informational) */
  iteration?: string;
  plannedStartDate?: string;
  plannedEndDate?: string;
  /**
   * Ordered list of member test case Zephyr keys.
   * Position in this array = intended execution order in the Test Set.
   */
  memberKeys: string[];
}

export interface ZephyrAttachmentRef {
  /** Index in the testCases array */
  testCaseIndex: number;
  /** Step position (0-based) where the image appears */
  stepPosition: number;
  /** Local file path to the image */
  localPath: string;
  /** Original attachment ID from Zephyr */
  attachmentId: string;
}

/**
 * Detects whether a given path looks like a Zephyr Scale bundle directory.
 * Checks: is a directory, contains a testcases/ subdirectory with at least one .json file.
 */
export function isZephyrBundle(sourcePath: string): boolean {
  try {
    const stat = fs.statSync(sourcePath);
    if (!stat.isDirectory()) return false;

    const testcasesDir = path.join(sourcePath, 'testcases');
    if (!fs.existsSync(testcasesDir)) return false;

    const files = fs.readdirSync(testcasesDir);
    return files.some(f => f.endsWith('.json'));
  } catch {
    return false;
  }
}

/**
 * Parses a Zephyr Scale bundle directory into TransformedTestCase[].
 * This is a direct structural mapping — no heuristics or LLM involved.
 */
export function parseZephyrBundle(bundlePath: string): ZephyrBundleResult {
  const testcasesDir = path.join(bundlePath, 'testcases');
  const inlineDir = path.join(bundlePath, 'attachments', 'inline');

  // Load attachment map if present
  let attachmentMap: AttachmentMap = {};
  const mapPath = path.join(inlineDir, '_map.json');
  if (fs.existsSync(mapPath)) {
    attachmentMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
  }

  // Read manifest for informational purposes
  let manifest: string | undefined;
  const manifestPath = path.join(bundlePath, 'MANIFEST.txt');
  if (fs.existsSync(manifestPath)) {
    manifest = fs.readFileSync(manifestPath, 'utf-8');
  }

  // Read all test case JSON files
  const jsonFiles = fs.readdirSync(testcasesDir)
    .filter(f => f.endsWith('.json'))
    .sort(); // Deterministic ordering

  const testCases: TransformedTestCase[] = [];
  const pendingAttachments: ZephyrAttachmentRef[] = [];

  for (let i = 0; i < jsonFiles.length; i++) {
    const filePath = path.join(testcasesDir, jsonFiles[i]);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const zephyr: ZephyrTestCase = JSON.parse(raw);

    const { testCase, attachmentRefs } = mapZephyrToTransformed(zephyr, i, inlineDir, attachmentMap);
    testCases.push(testCase);
    pendingAttachments.push(...attachmentRefs);
  }

  // Read test cycle (Test Set), if present
  const testSet = parseTestCycle(bundlePath);

  return { testCases, pendingAttachments, manifest, testSet };
}

/**
 * Parses the testcycle/*.json file (if present) into a ZephyrTestSet.
 * Member order is taken from the cycle's items[] array.
 */
function parseTestCycle(bundlePath: string): ZephyrTestSet | undefined {
  const cycleDir = path.join(bundlePath, 'testcycle');
  if (!fs.existsSync(cycleDir)) return undefined;

  const cycleFiles = fs.readdirSync(cycleDir).filter(f => f.endsWith('.json')).sort();
  if (cycleFiles.length === 0) return undefined;

  // A bundle represents a single cycle; use the first file.
  const raw = fs.readFileSync(path.join(cycleDir, cycleFiles[0]), 'utf-8');
  const cycle: ZephyrTestCycle = JSON.parse(raw);

  const memberKeys = (cycle.items ?? [])
    .map(item => item.testCaseKey)
    .filter((k): k is string => !!k);

  return {
    key: cycle.key,
    name: cycle.name,
    folderPath: cycle.folder ?? undefined,
    status: cycle.status,
    iteration: cycle.iteration,
    plannedStartDate: cycle.plannedStartDate,
    plannedEndDate: cycle.plannedEndDate,
    memberKeys,
  };
}

// --- Internal mapping ---

function mapZephyrToTransformed(
  zephyr: ZephyrTestCase,
  index: number,
  inlineDir: string,
  attachmentMap: AttachmentMap,
): { testCase: TransformedTestCase; attachmentRefs: ZephyrAttachmentRef[] } {
  const attachmentRefs: ZephyrAttachmentRef[] = [];

  // Map test steps
  const testSteps: TransformedTestStep[] = [];
  if (zephyr.testScript?.type === 'STEP_BY_STEP' && zephyr.testScript.steps) {
    for (const step of zephyr.testScript.steps) {
      let sampleData = step.testData;

      // Resolve inline images in testData
      if (sampleData) {
        const { resolved, refs } = resolveInlineImages(
          sampleData,
          index,
          step.index,
          inlineDir,
          attachmentMap,
        );
        sampleData = resolved;
        attachmentRefs.push(...refs);
      }

      testSteps.push({
        description: step.description ?? '',
        expectedResult: step.expectedResult,
        sampleData,
        position: step.index + 1, // Spira uses 1-based positions
      });
    }
  }

  // Build description with Zephyr key for traceability
  const descriptionParts: string[] = [];
  descriptionParts.push(`[Source: ${zephyr.key}]`);
  if (zephyr.lastTestResultStatus) {
    descriptionParts.push(`Last execution: ${zephyr.lastTestResultStatus}`);
  }
  if (zephyr.createdBy) {
    descriptionParts.push(`Created by: ${zephyr.createdBy}`);
  }

  // Custom properties — stored by name, resolved to property numbers at import time
  // We use propertyNumber: -1 as a placeholder; the import engine resolves by name
  const customProperties = [];
  if (zephyr.customFields) {
    let cpIndex = 0;
    for (const [fieldName, fieldValue] of Object.entries(zephyr.customFields)) {
      customProperties.push({
        propertyNumber: -(cpIndex + 1), // Negative = "resolve by name at import time"
        name: fieldName,
        value: fieldValue,
      });
      cpIndex++;
    }
  }

  // Tags from labels
  const tags = zephyr.labels?.join(',') || undefined;

  const testCase: TransformedTestCase = {
    sourceRowIndex: index,
    name: zephyr.name,
    description: descriptionParts.join(' | '),
    customProperties: customProperties as any, // Extended with `name` field for resolution
    testSteps,
    folderPath: zephyr.folder ?? undefined,
    tags,
  };

  // Store raw priority/status/component for name-based resolution at import time
  // We attach these as extra metadata that the Zephyr pipeline path will resolve
  (testCase as any)._zephyrMeta = {
    priority: zephyr.priority,
    status: zephyr.status,
    component: zephyr.component,
    key: zephyr.key,
  };

  return { testCase, attachmentRefs };
}

/**
 * Resolves inline image references in step HTML.
 * Zephyr embeds images as: <img src="../rest/tests/1.0/attachment/image/{id}" ... />
 * We replace the src with a placeholder and track the local file for upload.
 */
function resolveInlineImages(
  html: string,
  testCaseIndex: number,
  stepPosition: number,
  inlineDir: string,
  attachmentMap: AttachmentMap,
): { resolved: string; refs: ZephyrAttachmentRef[] } {
  const refs: ZephyrAttachmentRef[] = [];

  // Match Zephyr inline image pattern
  const imgRegex = /src="[^"]*?\/attachment\/image\/(\d+)"/g;
  let match: RegExpExecArray | null;

  let resolved = html;
  while ((match = imgRegex.exec(html)) !== null) {
    const attachmentId = match[1];
    const localFilename = attachmentMap[attachmentId];

    if (localFilename) {
      const localPath = path.join(inlineDir, localFilename);
      if (fs.existsSync(localPath)) {
        refs.push({
          testCaseIndex,
          stepPosition,
          localPath,
          attachmentId,
        });
        // Replace the Zephyr URL with a marker indicating this will be uploaded
        resolved = resolved.replace(
          match[0],
          `src="[attachment:${localFilename}]"`,
        );
      }
    }
  }

  return { resolved, refs };
}
