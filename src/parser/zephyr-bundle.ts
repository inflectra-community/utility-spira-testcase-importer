/**
 * Zephyr Scale JSON Bundle Parser
 *
 * Parses a Zephyr Scale test cycle export bundle (directory containing testcases/*.json)
 * and maps directly to TransformedTestCase[] — no heuristics or LLM needed.
 *
 * Two bundle layouts are supported:
 *
 *   "Flat" (classic single-project export):
 *     <bundleDir>/
 *       testcases/       - One JSON file per test case (e.g. PROJ-T94.json)
 *       testcycle/       - One JSON file per test cycle → Spira Test Set
 *       attachments/inline/ - Inline images + _map.json
 *       MANIFEST.txt, checksums.txt, issues/
 *
 *   "Nested / multi-project" (newer migration export):
 *     <exportDir>/
 *       <PROJECT_A>/
 *         raw/testcases/   - Test case JSON files
 *         raw/testruns/    - Test cycle JSON files → one Spira Test Set each
 *         attachments/inline/
 *       <PROJECT_B>/ ...
 *
 * findZephyrBundles() discovers the bundle root(s) in either layout. Each root
 * is parsed independently into its own ZephyrBundleResult. parseZephyrBundle()
 * resolves the testcases/testcycle directories flexibly (directly under the
 * root, or nested under raw/, and accepts either "testcycle" or "testruns").
 *
 * Field mapping:
 *   name           → TestCase.Name
 *   key            → stored as description prefix "[PROJ-T94]"
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
  /**
   * Test sets (from testcycle/*.json or raw/testruns/*.json). A nested-format
   * project can contain several cycles; each becomes its own Spira Test Set.
   */
  testSets: ZephyrTestSet[];
  /**
   * First test set, kept for backward compatibility with callers that assumed
   * one cycle per bundle. Prefer `testSets`.
   */
  testSet?: ZephyrTestSet;
}

/**
 * A discovered Zephyr bundle root — a directory that directly contains the
 * test case data (either `testcases/` or `raw/testcases/`).
 */
export interface ZephyrBundleRef {
  /**
   * Display name for the bundle. For a nested multi-project export this is the
   * project folder name (e.g. "JBPT"); for a flat export it is the folder's
   * own name.
   */
  name: string;
  /** Absolute path to the bundle root directory. */
  path: string;
}

/**
 * A Zephyr test cycle mapped to a Spira Test Set candidate.
 * Member ordering is preserved from the cycle's items[] array.
 */
export interface ZephyrTestSet {
  /** Zephyr cycle key, e.g. "PROJ-C3730" */
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

/** Candidate relative locations for the test case JSON directory. */
const TESTCASE_DIR_CANDIDATES = ['testcases', path.join('raw', 'testcases')];
/** Candidate relative locations for the test cycle JSON directory. */
const CYCLE_DIR_CANDIDATES = ['testcycle', path.join('raw', 'testruns')];

/** Returns true if `dir` exists, is a directory, and holds at least one .json file. */
function hasJsonFiles(dir: string): boolean {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
    return fs.readdirSync(dir).some(f => f.endsWith('.json'));
  } catch {
    return false;
  }
}

/**
 * Resolves the test case directory for a bundle root, tolerating both the flat
 * (`testcases/`) and nested (`raw/testcases/`) layouts. Returns undefined if
 * none is found.
 */
function resolveTestcasesDir(bundleRoot: string): string | undefined {
  return TESTCASE_DIR_CANDIDATES
    .map(rel => path.join(bundleRoot, rel))
    .find(hasJsonFiles);
}

/**
 * Resolves the test cycle directory for a bundle root, accepting both
 * `testcycle/` (flat) and `raw/testruns/` (nested). Returns undefined if none.
 */
function resolveCycleDir(bundleRoot: string): string | undefined {
  return CYCLE_DIR_CANDIDATES
    .map(rel => path.join(bundleRoot, rel))
    .find(hasJsonFiles);
}

/**
 * Resolves the inline attachments directory, tolerating both `attachments/inline`
 * (flat + nested share this) relative to the bundle root.
 */
function resolveInlineDir(bundleRoot: string): string {
  return path.join(bundleRoot, 'attachments', 'inline');
}

/** True if the directory itself is a parseable Zephyr bundle root. */
function isBundleRoot(dir: string): boolean {
  return resolveTestcasesDir(dir) !== undefined;
}

/**
 * Discovers every Zephyr bundle root at or beneath `sourcePath`.
 *
 * Handles three cases:
 *   1. `sourcePath` is itself a bundle root (flat export)      → [sourcePath]
 *   2. `sourcePath` wraps one or more project subdirectories   → [each project]
 *      that are bundle roots (nested multi-project export)
 *   3. a single wrapper folder containing a bundle root        → [the inner root]
 *
 * Returns an empty array if nothing parseable is found or the path is not a
 * directory (e.g. an un-extracted .zip).
 */
export function findZephyrBundles(sourcePath: string): ZephyrBundleRef[] {
  try {
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  // Case 1: the path itself is a bundle root.
  if (isBundleRoot(sourcePath)) {
    return [{ name: path.basename(sourcePath), path: sourcePath }];
  }

  // Cases 2 & 3: look one level down for bundle roots (e.g. per-project folders).
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sourcePath, { withFileTypes: true });
  } catch {
    return [];
  }

  const bundles: ZephyrBundleRef[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const childPath = path.join(sourcePath, entry.name);
    if (isBundleRoot(childPath)) {
      bundles.push({ name: entry.name, path: childPath });
    }
  }

  return bundles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Detects whether a given path contains at least one Zephyr Scale bundle,
 * in either the flat or nested multi-project layout.
 */
export function isZephyrBundle(sourcePath: string): boolean {
  return findZephyrBundles(sourcePath).length > 0;
}

/**
 * Parses a Zephyr Scale bundle directory into TransformedTestCase[].
 * This is a direct structural mapping — no heuristics or LLM involved.
 */
export function parseZephyrBundle(bundlePath: string): ZephyrBundleResult {
  const testcasesDir = resolveTestcasesDir(bundlePath);
  if (!testcasesDir) {
    throw new Error(
      `Not a Zephyr bundle: no testcases/ or raw/testcases/ directory with JSON files found in "${bundlePath}".`,
    );
  }
  const inlineDir = resolveInlineDir(bundlePath);

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

  // Read test cycles (Test Sets), if present. A nested-format project may
  // contain several; each becomes its own Spira Test Set.
  const testSets = parseTestCycles(bundlePath);

  return { testCases, pendingAttachments, manifest, testSets, testSet: testSets[0] };
}

/**
 * Parses every testcycle/*.json (flat) or raw/testruns/*.json (nested) file
 * into ZephyrTestSet entries. Member order within each set is taken from the
 * cycle's items[] array. Returns an empty array if no cycles are present.
 */
function parseTestCycles(bundlePath: string): ZephyrTestSet[] {
  const cycleDir = resolveCycleDir(bundlePath);
  if (!cycleDir) return [];

  const cycleFiles = fs.readdirSync(cycleDir).filter(f => f.endsWith('.json')).sort();

  const testSets: ZephyrTestSet[] = [];
  for (const file of cycleFiles) {
    try {
      const raw = fs.readFileSync(path.join(cycleDir, file), 'utf-8');
      const cycle: ZephyrTestCycle = JSON.parse(raw);

      const memberKeys = (cycle.items ?? [])
        .map(item => item.testCaseKey)
        .filter((k): k is string => !!k);

      testSets.push({
        key: cycle.key,
        name: cycle.name,
        folderPath: cycle.folder ?? undefined,
        status: cycle.status,
        iteration: cycle.iteration,
        plannedStartDate: cycle.plannedStartDate,
        plannedEndDate: cycle.plannedEndDate,
        memberKeys,
      });
    } catch {
      // Skip malformed cycle files rather than failing the whole import.
    }
  }

  return testSets;
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
