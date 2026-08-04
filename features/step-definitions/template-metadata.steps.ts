/**
 * Step definitions for template-metadata.feature
 *
 * Tests metadata retrieval using a mock SpiraApiClient that returns
 * fixture data or controlled errors.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LogicWorld } from '../support/worlds/logic.world.js';
import { fetchAllMetadata, type MetadataResult } from '../../src/spira/metadata.js';
import { createTestableLogger } from '../../src/logger/index.js';
import type { SpiraApiClient } from '../../src/spira/client.js';
import type { SpiraConfig } from '../../src/types/config.js';

// --- State ---

interface MetadataState {
  metadataResult: MetadataResult | null;
  mockClient: SpiraApiClient;
  failingEndpoint: string | null;
  config: SpiraConfig;
  logger: ReturnType<typeof createTestableLogger>;
}

function getMetadataState(world: LogicWorld): MetadataState {
  if (!(world as any).__metadataState) {
    const logger = createTestableLogger();
    (world as any).__metadataState = {
      metadataResult: null,
      mockClient: buildMockClient(null),
      failingEndpoint: null,
      config: {
        baseUrl: 'https://spira.example.com',
        username: 'admin',
        apiKey: '{API-KEY}',
        projectId: 1,
      },
      logger,
    } as MetadataState;
  }
  return (world as any).__metadataState;
}

function buildMockClient(failingEndpoint: string | null): SpiraApiClient {
  function maybeThrow(endpoint: string) {
    if (failingEndpoint === endpoint) {
      throw new Error(`Server error: 500 Internal Server Error for ${endpoint}`);
    }
  }

  return {
    async authenticate() {},
    async getCustomProperties(_artifactTypeName: string) {
      maybeThrow('customProperties');
      return [
        {
          customPropertyId: 1,
          propertyNumber: 1,
          name: 'Automation Status',
          artifactTypeName: 'TestCase',
          customPropertyTypeId: 6,
          customPropertyTypeName: 'List',
          customListId: 1,
          isRequired: false,
        },
        {
          customPropertyId: 2,
          propertyNumber: 2,
          name: 'Test Environment',
          artifactTypeName: 'TestCase',
          customPropertyTypeId: 1,
          customPropertyTypeName: 'Text',
          isRequired: true,
        },
      ];
    },
    async getCustomListValues(customListId: number) {
      maybeThrow('customListValues');
      return [
        { customPropertyValueId: 1, name: 'Automated', active: true },
        { customPropertyValueId: 2, name: 'Not Automated', active: true },
        { customPropertyValueId: 3, name: 'Planned', active: true },
      ];
    },
    async getTestCasePriorities() {
      maybeThrow('priorities');
      return [
        { priorityId: 1, name: 'Critical', active: true, score: 4 },
        { priorityId: 2, name: 'High', active: true, score: 3 },
        { priorityId: 3, name: 'Medium', active: true, score: 2 },
        { priorityId: 4, name: 'Low', active: true, score: 1 },
      ];
    },
    async getTestCaseStatuses() {
      maybeThrow('statuses');
      return [
        { testCaseStatusId: 1, name: 'Draft', active: true },
        { testCaseStatusId: 2, name: 'Ready for Review', active: true },
        { testCaseStatusId: 3, name: 'Approved', active: true },
      ];
    },
    async getTestCaseTypes() {
      maybeThrow('types');
      return [
        { testCaseTypeId: 1, name: 'Functional', active: true, isDefault: true },
        { testCaseTypeId: 2, name: 'Performance', active: true, isDefault: false },
      ];
    },
    async getProjectUsers() {
      maybeThrow('users');
      return [
        { userId: 1, fullName: 'John Smith', userName: 'jsmith', active: true },
        { userId: 2, fullName: 'Jane Doe', userName: 'jdoe', active: true },
      ];
    },
    async getComponents() {
      maybeThrow('components');
      return [
        { componentId: 1, name: 'Login Module', active: true },
        { componentId: 2, name: 'Dashboard', active: true },
      ];
    },
    async getTestFolders() {
      maybeThrow('existingFolders');
      return [];
    },
    async createTestFolder(folder: any) {
      return { testCaseFolderId: 100, name: folder.Name, indentLevel: '0' };
    },
    async createTestCase(testCase: any) {
      return { TestCaseId: 1 };
    },
    async addTestSteps() {},
  };
}

// --- Given steps ---

Given('I am authenticated against a Spira instance', function (this: LogicWorld) {
  const state = getMetadataState(this);
  // Authentication is implicit in our mock — no real network call
  assert.ok(state.config.baseUrl, 'Should have a base URL configured');
});

Given('a target project is specified', function (this: LogicWorld) {
  const state = getMetadataState(this);
  assert.ok(state.config.projectId > 0, 'Should have a project ID');
});

Given('the project template has custom properties of type {string}', function (this: LogicWorld, _type: string) {
  // Already set up — the mock client returns list-type custom properties
  const state = getMetadataState(this);
  assert.ok(state.mockClient, 'Mock client should be ready');
});

Given('one of the metadata endpoints returns a server error', function (this: LogicWorld) {
  const state = getMetadataState(this);
  state.failingEndpoint = 'priorities';
  state.mockClient = buildMockClient(state.failingEndpoint);
});

// --- When steps ---

When('the Importer fetches template metadata', async function (this: LogicWorld) {
  const state = getMetadataState(this);
  state.metadataResult = await fetchAllMetadata(
    state.mockClient,
    state.config,
    1, // templateId
    state.logger,
  );
});

// --- Then steps ---

Then('it should retrieve all custom property definitions for test cases', function (this: LogicWorld) {
  const state = getMetadataState(this);
  assert.ok(state.metadataResult, 'Metadata result should exist');
  const cps = state.metadataResult.metadata.customProperties;
  assert.ok(cps.length > 0, 'Should have custom properties');
});

Then('each custom property should include its name, type, and property number', function (this: LogicWorld) {
  const state = getMetadataState(this);
  const cps = state.metadataResult!.metadata.customProperties;
  for (const cp of cps) {
    assert.ok(cp.name, 'Custom property should have a name');
    assert.ok(cp.customPropertyTypeName, 'Custom property should have a type name');
    assert.ok(typeof cp.propertyNumber === 'number', 'Custom property should have a property number');
  }
});

Then('it should retrieve all active custom list values for each list-type property', function (this: LogicWorld) {
  const state = getMetadataState(this);
  const lists = state.metadataResult!.metadata.customLists;
  assert.ok(lists.size > 0, 'Should have custom list values');
  for (const [_listId, values] of lists) {
    assert.ok(values.length > 0, 'Each list should have values');
    for (const v of values) {
      assert.ok(v.active, 'Values should be active');
    }
  }
});

Then('each list value should include its ID and name', function (this: LogicWorld) {
  const state = getMetadataState(this);
  const lists = state.metadataResult!.metadata.customLists;
  for (const [_listId, values] of lists) {
    for (const v of values) {
      assert.ok(typeof v.customPropertyValueId === 'number', 'List value should have an ID');
      assert.ok(v.name.length > 0, 'List value should have a name');
    }
  }
});

Then('it should retrieve the active test case priorities', function (this: LogicWorld) {
  const state = getMetadataState(this);
  const priorities = state.metadataResult!.metadata.priorities;
  if (state.failingEndpoint === 'priorities') {
    // If priorities endpoint failed, it should be empty but metadata should still exist
    assert.strictEqual(priorities.length, 0);
  } else {
    assert.ok(priorities.length > 0, 'Should have priorities');
  }
});

Then('it should retrieve the active test case statuses', function (this: LogicWorld) {
  const state = getMetadataState(this);
  const statuses = state.metadataResult!.metadata.statuses;
  assert.ok(statuses.length > 0, 'Should have statuses');
});

Then('it should retrieve the active test case types', function (this: LogicWorld) {
  const state = getMetadataState(this);
  const types = state.metadataResult!.metadata.types;
  assert.ok(types.length > 0, 'Should have types');
});

Then('it should retrieve the project components', function (this: LogicWorld) {
  const state = getMetadataState(this);
  const components = state.metadataResult!.metadata.components;
  assert.ok(components.length > 0, 'Should have components');
});

Then('it should retrieve the list of active users available for assignment', function (this: LogicWorld) {
  const state = getMetadataState(this);
  const users = state.metadataResult!.metadata.users;
  assert.ok(users.length > 0, 'Should have users');
});

Then('each user should include their ID and full name', function (this: LogicWorld) {
  const state = getMetadataState(this);
  const users = state.metadataResult!.metadata.users;
  for (const user of users) {
    assert.ok(typeof user.userId === 'number', 'User should have an ID');
    assert.ok(user.fullName.length > 0, 'User should have a full name');
  }
});

Then('it should report which specific metadata could not be retrieved', function (this: LogicWorld) {
  const state = getMetadataState(this);
  assert.ok(state.metadataResult, 'Metadata result should exist');
  assert.ok(state.metadataResult.failures.length > 0, 'Should have reported failures');
  const failedField = state.metadataResult.failures[0].field;
  assert.ok(failedField === state.failingEndpoint, `Should report "${state.failingEndpoint}" as failed`);
});

Then('it should still successfully retrieve all other metadata categories', function (this: LogicWorld) {
  const state = getMetadataState(this);
  assert.ok(state.metadataResult, 'Metadata result should exist');
  const m = state.metadataResult.metadata;
  // All non-failing categories should have data
  assert.ok(m.statuses.length > 0, 'Statuses should be retrieved');
  assert.ok(m.types.length > 0, 'Types should be retrieved');
  assert.ok(m.customProperties.length > 0, 'Custom properties should be retrieved');
  assert.ok(m.users.length > 0, 'Users should be retrieved');
  assert.ok(m.components.length > 0, 'Components should be retrieved');
});
