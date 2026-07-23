/**
 * Unit tests for fetchAllMetadata — verifies parallel retrieval, partial failure
 * handling, and custom list value fetching for list/multilist properties.
 */

import { describe, it, expect, vi } from 'vitest';
import { fetchAllMetadata } from './metadata.js';
import type { SpiraApiClient } from './client.js';
import type { SpiraConfig } from '../types/config.js';
import type {
  CustomPropertyDefinition,
  CustomListValue,
  TestCasePriority,
  TestCaseStatus,
  TestCaseType,
  ProjectUser,
  Component,
  TestCaseFolder,
} from '../types/spira.js';

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    apiRequest: vi.fn(),
    persist: vi.fn(),
  };
}

function createMockConfig(): SpiraConfig {
  return {
    baseUrl: 'https://spira.example.com',
    username: 'admin',
    apiKey: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
    projectId: 1,
  };
}

const samplePriorities: TestCasePriority[] = [
  { priorityId: 1, name: 'Critical', active: true, score: 4 },
  { priorityId: 2, name: 'High', active: true, score: 3 },
];

const sampleStatuses: TestCaseStatus[] = [
  { testCaseStatusId: 1, name: 'Draft', active: true },
  { testCaseStatusId: 2, name: 'Ready for Test', active: true },
];

const sampleTypes: TestCaseType[] = [
  { testCaseTypeId: 1, name: 'Functional', active: true, isDefault: true },
];

const sampleUsers: ProjectUser[] = [
  { userId: 1, fullName: 'Admin User', userName: 'admin', active: true },
];

const sampleComponents: Component[] = [
  { componentId: 1, name: 'Backend', active: true },
];

const sampleFolders: TestCaseFolder[] = [
  { testCaseFolderId: 1, name: 'Smoke Tests', indentLevel: 'AAA' },
];

const sampleCustomProperties: CustomPropertyDefinition[] = [
  {
    customPropertyId: 1,
    propertyNumber: 1,
    name: 'Environment',
    artifactTypeName: 'TestCase',
    customPropertyTypeId: 6,
    customPropertyTypeName: 'List',
    customListId: 10,
    isRequired: false,
  },
  {
    customPropertyId: 2,
    propertyNumber: 2,
    name: 'Notes',
    artifactTypeName: 'TestCase',
    customPropertyTypeId: 1,
    customPropertyTypeName: 'Text',
    isRequired: false,
  },
  {
    customPropertyId: 3,
    propertyNumber: 3,
    name: 'Tags',
    artifactTypeName: 'TestCase',
    customPropertyTypeId: 7,
    customPropertyTypeName: 'MultiList',
    customListId: 20,
    isRequired: false,
  },
];

const sampleListValues: CustomListValue[] = [
  { customPropertyValueId: 100, name: 'Production', active: true },
  { customPropertyValueId: 101, name: 'Staging', active: true },
];

const sampleMultiListValues: CustomListValue[] = [
  { customPropertyValueId: 200, name: 'Regression', active: true },
  { customPropertyValueId: 201, name: 'Integration', active: true },
];

function createFullMockClient(): SpiraApiClient {
  return {
    authenticate: vi.fn(),
    getCustomProperties: vi.fn().mockResolvedValue(sampleCustomProperties),
    getCustomListValues: vi.fn().mockImplementation((listId: number) => {
      if (listId === 10) return Promise.resolve(sampleListValues);
      if (listId === 20) return Promise.resolve(sampleMultiListValues);
      return Promise.resolve([]);
    }),
    getTestCasePriorities: vi.fn().mockResolvedValue(samplePriorities),
    getTestCaseStatuses: vi.fn().mockResolvedValue(sampleStatuses),
    getTestCaseTypes: vi.fn().mockResolvedValue(sampleTypes),
    getProjectUsers: vi.fn().mockResolvedValue(sampleUsers),
    getComponents: vi.fn().mockResolvedValue(sampleComponents),
    getTestFolders: vi.fn().mockResolvedValue(sampleFolders),
    createTestFolder: vi.fn(),
    createTestCase: vi.fn(),
    addTestSteps: vi.fn(),
    uploadDocument: vi.fn(),
  };
}

describe('fetchAllMetadata', () => {
  it('should assemble complete TemplateMetadata when all calls succeed', async () => {
    const client = createFullMockClient();
    const logger = createMockLogger();
    const config = createMockConfig();

    const result = await fetchAllMetadata(client, config, 42, logger);

    expect(result.failures).toHaveLength(0);
    expect(result.metadata.projectId).toBe(1);
    expect(result.metadata.templateId).toBe(42);
    expect(result.metadata.priorities).toEqual(samplePriorities);
    expect(result.metadata.statuses).toEqual(sampleStatuses);
    expect(result.metadata.types).toEqual(sampleTypes);
    expect(result.metadata.customProperties).toEqual(sampleCustomProperties);
    expect(result.metadata.users).toEqual(sampleUsers);
    expect(result.metadata.components).toEqual(sampleComponents);
    expect(result.metadata.existingFolders).toEqual(sampleFolders);
  });

  it('should fetch custom list values for list and multilist custom properties', async () => {
    const client = createFullMockClient();
    const logger = createMockLogger();
    const config = createMockConfig();

    const result = await fetchAllMetadata(client, config, 42, logger);

    expect(result.metadata.customLists.size).toBe(2);
    expect(result.metadata.customLists.get(10)).toEqual(sampleListValues);
    expect(result.metadata.customLists.get(20)).toEqual(sampleMultiListValues);
    expect(client.getCustomListValues).toHaveBeenCalledWith(10);
    expect(client.getCustomListValues).toHaveBeenCalledWith(20);
  });

  it('should not fetch custom list values when no list properties exist', async () => {
    const client = createFullMockClient();
    (client.getCustomProperties as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        customPropertyId: 1,
        propertyNumber: 1,
        name: 'Notes',
        artifactTypeName: 'TestCase',
        customPropertyTypeId: 1,
        customPropertyTypeName: 'Text',
        isRequired: false,
      },
    ]);
    const logger = createMockLogger();
    const config = createMockConfig();

    const result = await fetchAllMetadata(client, config, 42, logger);

    expect(result.metadata.customLists.size).toBe(0);
    expect(client.getCustomListValues).not.toHaveBeenCalled();
  });

  it('should deduplicate list IDs when multiple properties reference the same list', async () => {
    const client = createFullMockClient();
    (client.getCustomProperties as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        customPropertyId: 1,
        propertyNumber: 1,
        name: 'Environment',
        artifactTypeName: 'TestCase',
        customPropertyTypeId: 6,
        customPropertyTypeName: 'List',
        customListId: 10,
        isRequired: false,
      },
      {
        customPropertyId: 2,
        propertyNumber: 2,
        name: 'Region',
        artifactTypeName: 'TestCase',
        customPropertyTypeId: 6,
        customPropertyTypeName: 'List',
        customListId: 10,
        isRequired: false,
      },
    ]);
    const logger = createMockLogger();
    const config = createMockConfig();

    const result = await fetchAllMetadata(client, config, 42, logger);

    expect(result.metadata.customLists.size).toBe(1);
    expect(client.getCustomListValues).toHaveBeenCalledTimes(1);
    expect(client.getCustomListValues).toHaveBeenCalledWith(10);
  });

  it('should handle partial failures and continue with remaining metadata', async () => {
    const client = createFullMockClient();
    (client.getTestCasePriorities as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection timeout'),
    );
    (client.getComponents as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('403 Forbidden'),
    );
    const logger = createMockLogger();
    const config = createMockConfig();

    const result = await fetchAllMetadata(client, config, 42, logger);

    expect(result.failures).toHaveLength(2);
    expect(result.failures[0].field).toBe('priorities');
    expect(result.failures[0].error).toBe('Connection timeout');
    expect(result.failures[1].field).toBe('components');
    expect(result.failures[1].error).toBe('403 Forbidden');

    expect(result.metadata.priorities).toEqual([]);
    expect(result.metadata.components).toEqual([]);

    expect(result.metadata.statuses).toEqual(sampleStatuses);
    expect(result.metadata.types).toEqual(sampleTypes);
    expect(result.metadata.users).toEqual(sampleUsers);
    expect(result.metadata.existingFolders).toEqual(sampleFolders);
  });

  it('should handle custom list value fetch failure independently', async () => {
    const client = createFullMockClient();
    (client.getCustomListValues as ReturnType<typeof vi.fn>).mockImplementation(
      (listId: number) => {
        if (listId === 10) return Promise.reject(new Error('List not found'));
        if (listId === 20) return Promise.resolve(sampleMultiListValues);
        return Promise.resolve([]);
      },
    );
    const logger = createMockLogger();
    const config = createMockConfig();

    const result = await fetchAllMetadata(client, config, 42, logger);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].field).toBe('customList(10)');
    expect(result.metadata.customLists.get(10)).toEqual([]);
    expect(result.metadata.customLists.get(20)).toEqual(sampleMultiListValues);
  });

  it('should report all failures when everything fails', async () => {
    const client: SpiraApiClient = {
      authenticate: vi.fn(),
      getCustomProperties: vi.fn().mockRejectedValue(new Error('err1')),
      getCustomListValues: vi.fn().mockRejectedValue(new Error('err2')),
      getTestCasePriorities: vi.fn().mockRejectedValue(new Error('err3')),
      getTestCaseStatuses: vi.fn().mockRejectedValue(new Error('err4')),
      getTestCaseTypes: vi.fn().mockRejectedValue(new Error('err5')),
      getProjectUsers: vi.fn().mockRejectedValue(new Error('err6')),
      getComponents: vi.fn().mockRejectedValue(new Error('err7')),
      getTestFolders: vi.fn().mockRejectedValue(new Error('err8')),
      createTestFolder: vi.fn(),
      createTestCase: vi.fn(),
      addTestSteps: vi.fn(),
      uploadDocument: vi.fn(),
    };
    const logger = createMockLogger();
    const config = createMockConfig();

    const result = await fetchAllMetadata(client, config, 42, logger);

    expect(result.failures).toHaveLength(7);
    expect(result.metadata.priorities).toEqual([]);
    expect(result.metadata.statuses).toEqual([]);
    expect(result.metadata.types).toEqual([]);
    expect(result.metadata.customProperties).toEqual([]);
    expect(result.metadata.users).toEqual([]);
    expect(result.metadata.components).toEqual([]);
    expect(result.metadata.existingFolders).toEqual([]);
    expect(result.metadata.customLists.size).toBe(0);
  });

  it('should call getCustomProperties with "TestCase" artifact type', async () => {
    const client = createFullMockClient();
    const logger = createMockLogger();
    const config = createMockConfig();

    await fetchAllMetadata(client, config, 42, logger);

    expect(client.getCustomProperties).toHaveBeenCalledWith('TestCase');
  });
});
