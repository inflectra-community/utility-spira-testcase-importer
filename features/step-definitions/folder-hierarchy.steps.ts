/**
 * Step definitions for folder-hierarchy.feature
 *
 * Exercises the FolderResolver directly against mock client fixtures.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LogicWorld } from '../support/worlds/logic.world.js';
import { createFolderResolver, type FolderResolver } from '../../src/importer/folder-resolver.js';
import { createLogger } from '../../src/logger/index.js';
import type { TestCaseFolder } from '../../src/types/spira.js';

// --- State scoped to folder-hierarchy scenarios ---

interface FolderWorldState {
  folderResolver: FolderResolver | null;
  resolvedFolderIds: Map<string, number | null>; // path -> folderId
  createdFolderNames: string[];
  mockFolderIdCounter: number;
  existingFolders: TestCaseFolder[];
  testCaseFolderPaths: { name: string; folderPath?: string }[];
  hasFolderMapping: boolean;
}

function getFolderState(world: LogicWorld): FolderWorldState {
  if (!(world as any).__folderState) {
    (world as any).__folderState = {
      folderResolver: null,
      resolvedFolderIds: new Map(),
      createdFolderNames: [],
      mockFolderIdCounter: 100,
      existingFolders: [],
      testCaseFolderPaths: [],
      hasFolderMapping: true,
    } as FolderWorldState;
  }
  return (world as any).__folderState;
}

function buildMockClient(state: FolderWorldState) {
  return {
    async createTestFolder(request: { Name: string; ParentTestCaseFolderId?: number }) {
      state.mockFolderIdCounter++;
      const folder: TestCaseFolder = {
        testCaseFolderId: state.mockFolderIdCounter,
        name: request.Name,
        parentTestCaseFolderId: request.ParentTestCaseFolderId,
        indentLevel: '0',
      };
      state.createdFolderNames.push(request.Name);
      state.existingFolders.push(folder);
      return folder;
    },
  } as any;
}

function createResolver(state: FolderWorldState): FolderResolver {
  const logger = createLogger();
  const client = buildMockClient(state);
  return createFolderResolver(client, state.existingFolders, logger, '/');
}

// --- Given steps ---

Given('the source data has a column mapped to folder path', function (this: LogicWorld) {
  const state = getFolderState(this);
  state.hasFolderMapping = true;
  state.testCaseFolderPaths = [
    { name: 'Login test', folderPath: 'Auth/Login' },
    { name: 'Signup test', folderPath: 'Auth/Signup' },
    { name: 'Dashboard test', folderPath: 'UI/Dashboard' },
  ];
});

Given('the column contains hierarchical paths using a path separator', function (this: LogicWorld) {
  // Already set up — paths use '/'
  const state = getFolderState(this);
  assert.ok(state.testCaseFolderPaths.some(tc => tc.folderPath?.includes('/')));
});

Given('the Spira project already has a folder matching a path in the source data', function (this: LogicWorld) {
  const state = getFolderState(this);
  // Pre-populate an existing folder "Auth" at root level
  state.existingFolders = [
    { testCaseFolderId: 10, name: 'Auth', parentTestCaseFolderId: undefined, indentLevel: '0' },
  ];
  state.testCaseFolderPaths = [
    { name: 'Login test', folderPath: 'Auth/Login' },
    { name: 'Logout test', folderPath: 'Auth/Logout' },
  ];
});

Given('the mapping does not include a folder path column', function (this: LogicWorld) {
  const state = getFolderState(this);
  state.hasFolderMapping = false;
  state.testCaseFolderPaths = [
    { name: 'Test A', folderPath: undefined },
    { name: 'Test B', folderPath: undefined },
  ];
});

Given('the source data contains a deeply nested folder path', function (this: LogicWorld) {
  const state = getFolderState(this);
  state.testCaseFolderPaths = [
    { name: 'Deep test', folderPath: 'Level1/Level2/Level3/Level4' },
  ];
});

Given('multiple source rows reference the same folder path', function (this: LogicWorld) {
  const state = getFolderState(this);
  state.testCaseFolderPaths = [
    { name: 'Test A', folderPath: 'Shared/Folder' },
    { name: 'Test B', folderPath: 'Shared/Folder' },
    { name: 'Test C', folderPath: 'Shared/Folder' },
  ];
});

// --- When steps ---

When('the import resolves folders', async function (this: LogicWorld) {
  const state = getFolderState(this);
  state.folderResolver = createResolver(state);

  for (const tc of state.testCaseFolderPaths) {
    const folderId = await state.folderResolver.resolve(tc.folderPath);
    state.resolvedFolderIds.set(tc.name, folderId);
  }
});

When('test cases are imported', async function (this: LogicWorld) {
  const state = getFolderState(this);
  state.folderResolver = createResolver(state);

  for (const tc of state.testCaseFolderPaths) {
    const folderId = await state.folderResolver.resolve(tc.folderPath);
    state.resolvedFolderIds.set(tc.name, folderId);
  }
});

// --- Then steps ---

Then('all necessary parent and child folders should be created in Spira', function (this: LogicWorld) {
  const state = getFolderState(this);
  const created = state.folderResolver!.getCreatedFolders();
  assert.ok(created.length > 0, 'Should have created at least one folder');
  // Verify we have parent folders for every path segment
  for (const tc of state.testCaseFolderPaths) {
    if (!tc.folderPath) continue;
    const segments = tc.folderPath.split('/');
    // The deepest folder should exist in cache (resolved)
    const folderId = state.resolvedFolderIds.get(tc.name);
    assert.ok(folderId !== null, `Test case "${tc.name}" should have a folder ID`);
  }
});

Then('each test case should be assigned to the folder matching its path', function (this: LogicWorld) {
  const state = getFolderState(this);
  for (const tc of state.testCaseFolderPaths) {
    if (!tc.folderPath) continue;
    const folderId = state.resolvedFolderIds.get(tc.name);
    assert.ok(typeof folderId === 'number', `Test case "${tc.name}" should have a numeric folder ID`);
  }
});

Then('it should reuse the existing folder', function (this: LogicWorld) {
  const state = getFolderState(this);
  // "Auth" already existed at ID 10 — shouldn't be in created list
  const created = state.folderResolver!.getCreatedFolders();
  assert.ok(!created.includes('Auth'), '"Auth" should have been reused, not created');
});

Then('it should only create folders that do not already exist', function (this: LogicWorld) {
  const state = getFolderState(this);
  const created = state.folderResolver!.getCreatedFolders();
  // "Auth" was pre-existing, so only sub-folders should be created
  for (const path of created) {
    assert.ok(path !== 'Auth', `Should not have re-created existing folder "Auth". Created: ${created}`);
  }
  assert.ok(created.length > 0, 'Should have created child folders');
});

Then('all test cases should be placed at the root level of the test case tree', function (this: LogicWorld) {
  const state = getFolderState(this);
  for (const tc of state.testCaseFolderPaths) {
    const folderId = state.resolvedFolderIds.get(tc.name);
    assert.strictEqual(folderId, null, `Test case "${tc.name}" should be at root (null folder ID)`);
  }
});

Then('all intermediate folders in the path should be created', function (this: LogicWorld) {
  const state = getFolderState(this);
  const created = state.folderResolver!.getCreatedFolders();
  // For "Level1/Level2/Level3/Level4" we expect all 4 segments to be created
  assert.ok(created.some(p => p === 'Level1'), 'Should have created Level1');
  assert.ok(created.some(p => p.includes('Level2')), 'Should have created Level2');
  assert.ok(created.some(p => p.includes('Level3')), 'Should have created Level3');
  assert.ok(created.some(p => p.includes('Level4')), 'Should have created Level4');
});

Then('the test case should be assigned to the deepest folder', function (this: LogicWorld) {
  const state = getFolderState(this);
  const folderId = state.resolvedFolderIds.get('Deep test');
  assert.ok(typeof folderId === 'number', 'Deep test should have a folder ID');
  // The ID should be the last one created (highest counter)
  assert.ok(folderId! > 100, 'Folder ID should be from the mock counter');
});

Then('only one folder should be created for that path', function (this: LogicWorld) {
  const state = getFolderState(this);
  const created = state.folderResolver!.getCreatedFolders();
  // "Shared/Folder" should only appear once in created paths
  const fullPathCount = created.filter(p => p === 'Shared/Folder').length;
  assert.strictEqual(fullPathCount, 1, `Expected "Shared/Folder" created once, got ${fullPathCount}. Created: ${created}`);
});

Then('all matching test cases should be assigned to it', function (this: LogicWorld) {
  const state = getFolderState(this);
  const ids = state.testCaseFolderPaths.map(tc => state.resolvedFolderIds.get(tc.name));
  // All should have the same non-null folder ID
  const uniqueIds = new Set(ids);
  assert.strictEqual(uniqueIds.size, 1, `All test cases should share the same folder ID, got: ${[...uniqueIds]}`);
  assert.ok([...uniqueIds][0] !== null, 'Folder ID should not be null');
});
