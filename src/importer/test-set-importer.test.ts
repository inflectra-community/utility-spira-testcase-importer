/**
 * Unit tests for the Test Set importer.
 *
 * Focus: member ordering (the add-then-reorder two-phase flow, 1-based Position,
 * dedup of repeated test cases, skipping unresolved members) and the dry-run plan.
 */

import { describe, it, expect, vi } from 'vitest';
import { importTestSet, type TestSetImportConfig } from './test-set-importer.js';
import type { SpiraApiClient } from '../spira/client.js';
import type { Logger } from '../logger/index.js';
import type { ZephyrTestSet } from '../parser/zephyr-bundle.js';
import type { TestSetTestCaseMapping } from '../types/import.js';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), apiRequest: vi.fn(), persist: vi.fn().mockResolvedValue(undefined) };
}

/**
 * Mock client that simulates the Spira Test Set endpoints.
 * Records added test cases and synthesises mappings for the ordering PUT.
 */
function mockClient(overrides?: Partial<SpiraApiClient>) {
  const added: number[] = [];
  const putCalls: TestSetTestCaseMapping[] = [];
  let nextMappingId = 1000;

  const client = {
    authenticate: vi.fn(),
    getCustomProperties: vi.fn(), getCustomListValues: vi.fn(),
    getTestCasePriorities: vi.fn(), getTestCaseStatuses: vi.fn(), getTestCaseTypes: vi.fn(),
    getProjectUsers: vi.fn(), getComponents: vi.fn(), getTestFolders: vi.fn(),
    createTestFolder: vi.fn(), createTestCase: vi.fn(), addTestSteps: vi.fn(), uploadDocument: vi.fn(),
    getTestSetFolders: vi.fn().mockResolvedValue([]),
    createTestSetFolder: vi.fn().mockResolvedValue({ testSetFolderId: 500, name: 'f', indentLevel: '0' }),
    createTestSet: vi.fn().mockResolvedValue({ TestSetId: 61 }),
    addTestCaseToSet: vi.fn().mockImplementation(async (_tsId: number, tcId: number) => { added.push(tcId); }),
    getTestCaseMappings: vi.fn().mockImplementation(async () =>
      // Return mappings in insertion order, each with Position matching insertion (1-based).
      added.map((tcId, i) => ({ TestSetTestCaseId: nextMappingId + i, TestSetId: 61, TestCaseId: tcId, Position: i + 1 }))
    ),
    updateTestCaseMapping: vi.fn().mockImplementation(async (_tsId: number, m: TestSetTestCaseMapping) => { putCalls.push(m); }),
    ...overrides,
  } as unknown as SpiraApiClient;

  return { client, added, putCalls };
}

function testSet(memberKeys: string[], folderPath?: string): ZephyrTestSet {
  return { key: 'PROJ-C1', name: 'Cycle One', folderPath, memberKeys };
}

function config(client: SpiraApiClient): TestSetImportConfig {
  return { client, logger: mockLogger(), existingTestSetFolders: [] };
}

describe('importTestSet — live', () => {
  it('creates the set and adds members in cycle order', async () => {
    const { client, added } = mockClient();
    const keyToTestCaseId = new Map([['A', 101], ['B', 102], ['C', 103]]);

    const result = await importTestSet(
      { testSet: testSet(['A', 'B', 'C']), keyToTestCaseId },
      config(client),
      { dryRun: false },
    );

    expect(result.testSetId).toBe(61);
    expect(result.membersAdded).toBe(3);
    expect(added).toEqual([101, 102, 103]); // added in cycle order
  });

  it('skips members whose test case was not imported', async () => {
    const { client, added } = mockClient();
    const keyToTestCaseId = new Map([['A', 101], ['C', 103]]); // B missing

    const result = await importTestSet(
      { testSet: testSet(['A', 'B', 'C']), keyToTestCaseId },
      config(client),
      { dryRun: false },
    );

    expect(result.membersAdded).toBe(2);
    expect(result.membersSkipped).toBe(1);
    expect(added).toEqual([101, 103]);
    expect(result.warnings.some(w => w.includes('"B"'))).toBe(true);
  });

  it('does not reorder when members are already in the intended order', async () => {
    // The mock returns Position = insertion order, which already matches the cycle,
    // so applyOrdering should PUT nothing.
    const { client, putCalls } = mockClient();
    const keyToTestCaseId = new Map([['A', 101], ['B', 102], ['C', 103]]);

    const result = await importTestSet(
      { testSet: testSet(['A', 'B', 'C']), keyToTestCaseId },
      config(client),
      { dryRun: false },
    );

    expect(result.orderingApplied).toBe(true);
    expect(putCalls).toHaveLength(0); // already ordered → no PUTs
  });

  it('issues reordering PUTs when the stored order differs from the cycle', async () => {
    // Simulate Spira returning mappings in a DIFFERENT order than added.
    const { client, putCalls } = mockClient({
      getTestCaseMappings: vi.fn().mockResolvedValue([
        { TestSetTestCaseId: 1, TestSetId: 61, TestCaseId: 103, Position: 1 },
        { TestSetTestCaseId: 2, TestSetId: 61, TestCaseId: 101, Position: 2 },
        { TestSetTestCaseId: 3, TestSetId: 61, TestCaseId: 102, Position: 3 },
      ]) as unknown as SpiraApiClient['getTestCaseMappings'],
    });
    const keyToTestCaseId = new Map([['A', 101], ['B', 102], ['C', 103]]);

    const result = await importTestSet(
      { testSet: testSet(['A', 'B', 'C']), keyToTestCaseId },
      config(client),
      { dryRun: false },
    );

    expect(result.orderingApplied).toBe(true);
    // Intended: 101→pos1, 102→pos2, 103→pos3. All three differ from stored → 3 PUTs.
    expect(putCalls.length).toBeGreaterThan(0);
    const posForTc = new Map(putCalls.map(p => [p.TestCaseId, p.Position]));
    expect(posForTc.get(101)).toBe(1);
    expect(posForTc.get(102)).toBe(2);
    expect(posForTc.get(103)).toBe(3);
  });

  it('creates the test set folder when a folder path is given', async () => {
    const { client } = mockClient();
    const createFolder = client.createTestSetFolder as ReturnType<typeof vi.fn>;
    const keyToTestCaseId = new Map([['A', 101]]);

    await importTestSet(
      { testSet: testSet(['A'], 'DE/E2E/O2C'), keyToTestCaseId },
      config(client),
      { dryRun: false },
    );

    expect(createFolder).toHaveBeenCalled();
  });
});

describe('importTestSet — dry run', () => {
  it('reports the planned members without creating anything', async () => {
    const { client, added } = mockClient();
    const createSet = client.createTestSet as ReturnType<typeof vi.fn>;
    const keyToTestCaseId = new Map([['A', 101], ['B', 102]]);

    const result = await importTestSet(
      { testSet: testSet(['A', 'B', 'missing']), keyToTestCaseId },
      config(client),
      { dryRun: true },
    );

    expect(createSet).not.toHaveBeenCalled();
    expect(added).toHaveLength(0);
    expect(result.plannedMembers).toEqual(['A', 'B']);
    expect(result.membersSkipped).toBe(1);
  });
});
