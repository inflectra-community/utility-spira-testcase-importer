/**
 * Unit tests for Zephyr bundle discovery and parsing.
 *
 * Focus: the discovery layer that recognizes both the classic "flat" layout
 * (testcases/ + testcycle/ directly under the bundle) and the newer nested
 * multi-project layout (<project>/raw/testcases/ + <project>/raw/testruns/).
 *
 * Fixtures are built on disk in a temp dir so the real fs-based resolvers run.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { findZephyrBundles, isZephyrBundle, parseZephyrBundle } from './zephyr-bundle.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-bundle-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Writes a minimal Zephyr test case JSON to `dir`. */
function writeTestCase(dir: string, key: string, name: string, folder = '/A/B'): void {
  fs.mkdirSync(dir, { recursive: true });
  const tc = {
    key,
    name,
    folder,
    priority: 'High',
    status: 'Approved',
    testScript: {
      id: 1,
      type: 'STEP_BY_STEP',
      steps: [{ index: 0, description: 'do a thing', expectedResult: 'it happens', id: 10 }],
    },
  };
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(tc), 'utf-8');
}

/** Writes a Zephyr test cycle JSON to `dir`. */
function writeCycle(dir: string, key: string, name: string, memberKeys: string[], folder = '/Cycles'): void {
  fs.mkdirSync(dir, { recursive: true });
  const cycle = {
    key,
    name,
    folder,
    items: memberKeys.map((k, i) => ({ testCaseKey: k, id: i + 1, status: 'Not Executed' })),
  };
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(cycle), 'utf-8');
}

/** Creates a flat-layout bundle under `root`. */
function makeFlatBundle(root: string): void {
  writeTestCase(path.join(root, 'testcases'), 'PROJ-T1', 'Flat case one');
  writeTestCase(path.join(root, 'testcases'), 'PROJ-T2', 'Flat case two');
  writeCycle(path.join(root, 'testcycle'), 'PROJ-C1', 'Flat cycle', ['PROJ-T1', 'PROJ-T2']);
}

/** Creates a nested-layout project (raw/testcases + raw/testruns) under `projectDir`. */
function makeNestedProject(projectDir: string, prefix: string, cycleCount: number): void {
  writeTestCase(path.join(projectDir, 'raw', 'testcases'), `${prefix}-T1`, `${prefix} case one`);
  writeTestCase(path.join(projectDir, 'raw', 'testcases'), `${prefix}-T2`, `${prefix} case two`);
  for (let i = 1; i <= cycleCount; i++) {
    writeCycle(path.join(projectDir, 'raw', 'testruns'), `${prefix}-C${i}`, `${prefix} cycle ${i}`, [`${prefix}-T1`, `${prefix}-T2`]);
  }
}

describe('findZephyrBundles', () => {
  it('recognizes a flat bundle as a single bundle rooted at the folder itself', () => {
    const root = path.join(tmpDir, 'flat');
    makeFlatBundle(root);

    const bundles = findZephyrBundles(root);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].path).toBe(root);
    expect(bundles[0].name).toBe('flat');
  });

  it('discovers each project in a nested multi-project export', () => {
    const root = path.join(tmpDir, 'migration');
    makeNestedProject(path.join(root, 'JBPT'), 'JBPT', 4);
    makeNestedProject(path.join(root, 'TCP1'), 'TCP1', 2);

    const bundles = findZephyrBundles(root);
    expect(bundles.map(b => b.name)).toEqual(['JBPT', 'TCP1']); // sorted
    expect(bundles[0].path).toBe(path.join(root, 'JBPT'));
  });

  it('unwraps a single wrapper folder around a nested project', () => {
    const root = path.join(tmpDir, 'wrapped');
    makeNestedProject(path.join(root, 'OnlyProject'), 'OP', 1);

    const bundles = findZephyrBundles(root);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].name).toBe('OnlyProject');
  });

  it('returns nothing for a non-existent path', () => {
    expect(findZephyrBundles(path.join(tmpDir, 'nope'))).toEqual([]);
  });

  it('returns nothing for a file (e.g. an un-extracted zip)', () => {
    const zipLike = path.join(tmpDir, 'bundle.zip');
    fs.writeFileSync(zipLike, 'not really a zip', 'utf-8');
    expect(findZephyrBundles(zipLike)).toEqual([]);
  });

  it('returns nothing for a directory with no testcases', () => {
    const empty = path.join(tmpDir, 'empty');
    fs.mkdirSync(path.join(empty, 'random'), { recursive: true });
    expect(findZephyrBundles(empty)).toEqual([]);
  });
});

describe('isZephyrBundle', () => {
  it('is true for both flat and nested layouts', () => {
    const flat = path.join(tmpDir, 'isflat');
    makeFlatBundle(flat);
    const nested = path.join(tmpDir, 'isnested');
    makeNestedProject(path.join(nested, 'P'), 'P', 1);

    expect(isZephyrBundle(flat)).toBe(true);
    expect(isZephyrBundle(nested)).toBe(true);
  });

  it('is false for a plain folder', () => {
    const plain = path.join(tmpDir, 'plain');
    fs.mkdirSync(plain, { recursive: true });
    expect(isZephyrBundle(plain)).toBe(false);
  });
});

describe('parseZephyrBundle', () => {
  it('parses a flat bundle into test cases and a single test set', () => {
    const root = path.join(tmpDir, 'parseflat');
    makeFlatBundle(root);

    const result = parseZephyrBundle(root);
    expect(result.testCases).toHaveLength(2);
    expect(result.testSets).toHaveLength(1);
    expect(result.testSet).toBe(result.testSets[0]); // back-compat alias
    expect(result.testSets[0].memberKeys).toEqual(['PROJ-T1', 'PROJ-T2']);
  });

  it('parses a nested project with multiple cycles into multiple test sets', () => {
    const projectDir = path.join(tmpDir, 'parsenested', 'JBPT');
    makeNestedProject(projectDir, 'JBPT', 4);

    const result = parseZephyrBundle(projectDir);
    expect(result.testCases).toHaveLength(2);
    expect(result.testSets).toHaveLength(4);
    expect(result.testSet).toBe(result.testSets[0]);
    const names = result.testSets.map(ts => ts.name).sort();
    expect(names).toEqual(['JBPT cycle 1', 'JBPT cycle 2', 'JBPT cycle 3', 'JBPT cycle 4']);
  });

  it('maps step and folder fields correctly from the nested layout', () => {
    const projectDir = path.join(tmpDir, 'parsefields', 'P');
    makeNestedProject(projectDir, 'P', 1);

    const result = parseZephyrBundle(projectDir);
    const tc = result.testCases.find(t => t.name === 'P case one')!;
    expect(tc.folderPath).toBe('/A/B');
    expect(tc.testSteps).toHaveLength(1);
    expect(tc.testSteps[0].description).toBe('do a thing');
    expect(tc.testSteps[0].expectedResult).toBe('it happens');
  });

  it('skips malformed cycle files rather than throwing', () => {
    const projectDir = path.join(tmpDir, 'badcycle', 'P');
    makeNestedProject(projectDir, 'P', 1);
    fs.writeFileSync(path.join(projectDir, 'raw', 'testruns', 'broken.json'), '{ not valid json', 'utf-8');

    const result = parseZephyrBundle(projectDir);
    // The one good cycle survives; the broken one is skipped.
    expect(result.testSets).toHaveLength(1);
  });

  it('throws a clear error when no testcases directory exists', () => {
    const empty = path.join(tmpDir, 'notabundle');
    fs.mkdirSync(empty, { recursive: true });
    expect(() => parseZephyrBundle(empty)).toThrow(/Not a Zephyr bundle/);
  });

  it('returns an empty testSets array when no cycles are present', () => {
    const root = path.join(tmpDir, 'nocycles');
    writeTestCase(path.join(root, 'testcases'), 'X-T1', 'lonely case');

    const result = parseZephyrBundle(root);
    expect(result.testCases).toHaveLength(1);
    expect(result.testSets).toEqual([]);
    expect(result.testSet).toBeUndefined();
  });
});
