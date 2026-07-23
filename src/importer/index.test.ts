/**
 * Unit tests for the Import Engine.
 * Tests progress callback, failure isolation, dry-run mode, and basic import flow.
 */

import { describe, it, expect, vi } from 'vitest';
import { createImportEngine, type ProgressCallback } from './index.js';
import type { SpiraApiClient } from '../spira/client.js';
import type { Logger } from '../logger/index.js';
import type { CustomPropertyDefinition } from '../types/spira.js';
import type { TransformedTestCase } from '../types/transform.js';

/** Helper to create a minimal mock SpiraApiClient */
function createMockClient(overrides?: Partial<SpiraApiClient>): SpiraApiClient {
  return {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getCustomProperties: vi.fn().mockResolvedValue([]),
    getCustomListValues: vi.fn().mockResolvedValue([]),
    getTestCasePriorities: vi.fn().mockResolvedValue([]),
    getTestCaseStatuses: vi.fn().mockResolvedValue([]),
    getTestCaseTypes: vi.fn().mockResolvedValue([]),
    getProjectUsers: vi.fn().mockResolvedValue([]),
    getComponents: vi.fn().mockResolvedValue([]),
    getTestFolders: vi.fn().mockResolvedValue([]),
    createTestFolder: vi.fn().mockResolvedValue({ testCaseFolderId: 100, name: 'folder', indentLevel: '0' }),
    createTestCase: vi.fn().mockResolvedValue({ TestCaseId: 1 }),
    addTestSteps: vi.fn().mockResolvedValue(undefined),
    uploadDocument: vi.fn().mockResolvedValue({ DocumentId: 1 }),
    ...overrides,
  };
}

/** Helper to create a minimal mock Logger */
function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    apiRequest: vi.fn(),
    persist: vi.fn().mockResolvedValue(undefined),
  };
}

/** Helper to create a test case */
function makeTestCase(index: number, opts?: Partial<TransformedTestCase>): TransformedTestCase {
  return {
    sourceRowIndex: index,
    name: `Test Case ${index}`,
    description: `Description for test case ${index}`,
    testCaseStatusId: 1,
    testCaseTypeId: 2,
    customProperties: [],
    testSteps: [],
    ...opts,
  };
}

describe('ImportEngine', () => {
  describe('progress callback', () => {
    it('should call onProgress for each test case', async () => {
      const client = createMockClient();
      const logger = createMockLogger();
      const progressCalls: [number, number, string][] = [];

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: [],
      });

      const testCases = [makeTestCase(0), makeTestCase(1), makeTestCase(2)];
      const onProgress: ProgressCallback = (current, total, item) => {
        progressCalls.push([current, total, item]);
      };

      await engine.import(testCases, { dryRun: false, onProgress });

      expect(progressCalls).toHaveLength(3);
      expect(progressCalls[0]).toEqual([1, 3, 'Test Case 0']);
      expect(progressCalls[1]).toEqual([2, 3, 'Test Case 1']);
      expect(progressCalls[2]).toEqual([3, 3, 'Test Case 2']);
    });
  });

  describe('failure isolation', () => {
    it('should continue importing after a test case creation failure', async () => {
      let callCount = 0;
      const client = createMockClient({
        createTestCase: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 2) {
            return Promise.reject(new Error('API error on second test case'));
          }
          return Promise.resolve({ TestCaseId: callCount });
        }),
      });
      const logger = createMockLogger();

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: [],
      });

      const testCases = [makeTestCase(0), makeTestCase(1), makeTestCase(2)];
      const result = await engine.import(testCases, {
        dryRun: false,
        onProgress: () => {},
      });

      expect(result.totalAttempted).toBe(3);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].sourceRowIndex).toBe(1);
      expect(result.failures[0].testCaseName).toBe('Test Case 1');
      expect(result.failures[0].phase).toBe('testcase');
      expect(result.failures[0].error).toContain('API error on second test case');
    });

    it('should track correct accounting: successCount + failureCount == totalAttempted', async () => {
      let callCount = 0;
      const client = createMockClient({
        createTestCase: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount % 2 === 0) {
            return Promise.reject(new Error('Even index failure'));
          }
          return Promise.resolve({ TestCaseId: callCount });
        }),
      });
      const logger = createMockLogger();

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: [],
      });

      const testCases = [makeTestCase(0), makeTestCase(1), makeTestCase(2), makeTestCase(3)];
      const result = await engine.import(testCases, {
        dryRun: false,
        onProgress: () => {},
      });

      expect(result.successCount + result.failureCount).toBe(result.totalAttempted);
      expect(result.failureCount).toBe(result.failures.length);
    });
  });

  describe('dry-run mode', () => {
    it('should not make any mutating API calls in dry-run mode', async () => {
      const client = createMockClient();
      const logger = createMockLogger();

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: [],
      });

      const testCases = [makeTestCase(0), makeTestCase(1)];
      const result = await engine.import(testCases, {
        dryRun: true,
        onProgress: () => {},
      });

      expect(client.createTestCase).not.toHaveBeenCalled();
      expect(client.addTestSteps).not.toHaveBeenCalled();
      expect(client.createTestFolder).not.toHaveBeenCalled();
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.totalAttempted).toBe(2);
    });
  });

  describe('test steps', () => {
    it('should add test steps after creating the test case', async () => {
      const client = createMockClient({
        createTestCase: vi.fn().mockResolvedValue({ TestCaseId: 42 }),
      });
      const logger = createMockLogger();

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: [],
      });

      const testCase = makeTestCase(0, {
        testSteps: [
          { description: 'Step 1', expectedResult: 'Result 1', position: 1 },
          { description: 'Step 2', expectedResult: 'Result 2', sampleData: 'Data', position: 2 },
        ],
      });

      await engine.import([testCase], { dryRun: false, onProgress: () => {} });

      expect(client.addTestSteps).toHaveBeenCalledWith(42, [
        { Description: 'Step 1', ExpectedResult: 'Result 1', Position: 1, SampleData: undefined },
        { Description: 'Step 2', ExpectedResult: 'Result 2', SampleData: 'Data', Position: 2 },
      ]);
    });

    it('should report teststep phase on test step failure', async () => {
      const client = createMockClient({
        createTestCase: vi.fn().mockResolvedValue({ TestCaseId: 42 }),
        addTestSteps: vi.fn().mockRejectedValue(new Error('Step creation failed')),
      });
      const logger = createMockLogger();

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: [],
      });

      const testCase = makeTestCase(0, {
        testSteps: [{ description: 'Step 1', position: 1 }],
      });

      const result = await engine.import([testCase], { dryRun: false, onProgress: () => {} });

      expect(result.failureCount).toBe(1);
      expect(result.failures[0].phase).toBe('teststep');
    });
  });

  describe('folder resolution', () => {
    it('should resolve folder paths and assign folder IDs to test cases', async () => {
      const client = createMockClient({
        createTestFolder: vi.fn().mockResolvedValue({
          testCaseFolderId: 200,
          name: 'FolderA',
          indentLevel: '0',
        }),
        createTestCase: vi.fn().mockResolvedValue({ TestCaseId: 1 }),
      });
      const logger = createMockLogger();

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: [],
      });

      const testCase = makeTestCase(0, { folderPath: 'FolderA' });
      await engine.import([testCase], { dryRun: false, onProgress: () => {} });

      // The test case should have been created with a folder ID
      expect(client.createTestCase).toHaveBeenCalledWith(
        expect.objectContaining({ TestCaseFolderId: 200 }),
      );
    });

    it('should not create folders in dry-run mode', async () => {
      const client = createMockClient();
      const logger = createMockLogger();

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: [],
      });

      const testCase = makeTestCase(0, { folderPath: 'FolderA/FolderB' });
      await engine.import([testCase], { dryRun: true, onProgress: () => {} });

      expect(client.createTestFolder).not.toHaveBeenCalled();
    });

    it('should report folder phase on folder resolution failure', async () => {
      const client = createMockClient({
        createTestFolder: vi.fn().mockRejectedValue(new Error('Folder API error')),
        createTestCase: vi.fn().mockResolvedValue({ TestCaseId: 1 }),
      });
      const logger = createMockLogger();

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: [],
      });

      const testCase = makeTestCase(0, { folderPath: 'BadFolder' });
      const result = await engine.import([testCase], { dryRun: false, onProgress: () => {} });

      expect(result.failureCount).toBe(1);
      expect(result.failures[0].phase).toBe('folder');
    });
  });

  describe('custom properties', () => {
    it('should serialize custom properties in the test case request', async () => {
      const customPropertyDefs: CustomPropertyDefinition[] = [
        {
          customPropertyId: 1,
          propertyNumber: 1,
          name: 'Priority Label',
          artifactTypeName: 'TestCase',
          customPropertyTypeId: 1, // Text
          customPropertyTypeName: 'Text',
          isRequired: false,
        },
        {
          customPropertyId: 2,
          propertyNumber: 2,
          name: 'Score',
          artifactTypeName: 'TestCase',
          customPropertyTypeId: 2, // Integer
          customPropertyTypeName: 'Integer',
          isRequired: false,
        },
      ];

      const client = createMockClient({
        createTestCase: vi.fn().mockResolvedValue({ TestCaseId: 1 }),
      });
      const logger = createMockLogger();

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: customPropertyDefs,
      });

      const testCase = makeTestCase(0, {
        customProperties: [
          { propertyNumber: 1, value: 'High' },
          { propertyNumber: 2, value: 42 },
        ],
      });

      await engine.import([testCase], { dryRun: false, onProgress: () => {} });

      expect(client.createTestCase).toHaveBeenCalledWith(
        expect.objectContaining({
          CustomProperties: [
            { PropertyNumber: 1, StringValue: 'High' },
            { PropertyNumber: 2, IntegerValue: 42 },
          ],
        }),
      );
    });
  });

  describe('import result', () => {
    it('should return duration in milliseconds', async () => {
      const client = createMockClient();
      const logger = createMockLogger();

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: [],
      });

      const result = await engine.import([makeTestCase(0)], {
        dryRun: false,
        onProgress: () => {},
      });

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });

    it('should track created folders', async () => {
      const client = createMockClient({
        createTestFolder: vi.fn().mockResolvedValue({
          testCaseFolderId: 300,
          name: 'NewFolder',
          indentLevel: '0',
        }),
        createTestCase: vi.fn().mockResolvedValue({ TestCaseId: 1 }),
      });
      const logger = createMockLogger();

      const engine = createImportEngine({
        client,
        logger,
        existingFolders: [],
        customPropertyDefinitions: [],
      });

      const testCase = makeTestCase(0, { folderPath: 'NewFolder' });
      const result = await engine.import([testCase], { dryRun: false, onProgress: () => {} });

      expect(result.createdFolders).toContain('NewFolder');
    });
  });
});
