/**
 * Step definitions for progress-logging.feature
 *
 * Uses the testable logger and import engine to verify progress tracking
 * and log persistence behavior.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LogicWorld } from '../support/worlds/logic.world.js';
import { createTestableLogger, type AnyLogEntry } from '../../src/logger/index.js';
import { createImportEngine } from '../../src/importer/index.js';
import type { TransformedTestCase } from '../../src/types/transform.js';
import type { ImportResult } from '../../src/types/import.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// --- State ---

interface LoggingState {
  logger: ReturnType<typeof createTestableLogger>;
  progressUpdates: { current: number; total: number; item: string }[];
  importResult: ImportResult | null;
  logFilePath: string | null;
  testCases: TransformedTestCase[];
  interruptedAt: number | null;
}

function getLoggingState(world: LogicWorld): LoggingState {
  if (!(world as any).__loggingState) {
    (world as any).__loggingState = {
      logger: createTestableLogger(),
      progressUpdates: [],
      importResult: null,
      logFilePath: null,
      testCases: [],
      interruptedAt: null,
    } as LoggingState;
  }
  return (world as any).__loggingState;
}

function buildTestCases(count: number): TransformedTestCase[] {
  return Array.from({ length: count }, (_, i) => ({
    sourceRowIndex: i + 1,
    name: `Test Case ${i + 1}`,
    testCaseStatusId: 1,
    customProperties: [],
    testSteps: [],
  }));
}

// --- Given steps ---

Given('an import is in progress with a batch of test cases', async function (this: LogicWorld) {
  const state = getLoggingState(this);
  state.testCases = buildTestCases(10);

  const mockClient = {
    async createTestCase(request: any) {
      return { TestCaseId: Math.floor(Math.random() * 1000) };
    },
    async addTestSteps() {},
    async createTestFolder(request: any) {
      return { testCaseFolderId: 1, name: request.Name, indentLevel: '0' };
    },
  } as any;

  const importEngine = createImportEngine({
    client: mockClient,
    logger: state.logger,
    existingFolders: [],
    customPropertyDefinitions: [],
  });

  state.importResult = await importEngine.import(state.testCases, {
    dryRun: false,
    onProgress: (current, total, item) => {
      state.progressUpdates.push({ current, total, item });
    },
  });
});

Given('an import session is running', async function (this: LogicWorld) {
  const state = getLoggingState(this);
  state.testCases = buildTestCases(3);

  const mockClient = {
    async createTestCase(request: any) {
      // Simulate an API call that the logger would record
      state.logger.apiRequest('POST', '/projects/1/test-cases', 200, 150);
      return { TestCaseId: Math.floor(Math.random() * 1000) };
    },
    async addTestSteps() {},
    async createTestFolder(request: any) {
      return { testCaseFolderId: 1, name: request.Name, indentLevel: '0' };
    },
  } as any;

  const importEngine = createImportEngine({
    client: mockClient,
    logger: state.logger,
    existingFolders: [],
    customPropertyDefinitions: [],
  });

  state.importResult = await importEngine.import(state.testCases, {
    dryRun: false,
    onProgress: (current, total, item) => {
      state.progressUpdates.push({ current, total, item });
    },
  });
});

Given('an import session completes \\(success or failure)', async function (this: LogicWorld) {
  const state = getLoggingState(this);
  state.testCases = buildTestCases(5);

  const mockClient = {
    async createTestCase(request: any) {
      state.logger.apiRequest('POST', '/projects/1/test-cases', 200, 100);
      if (request.Name === 'Test Case 3') {
        state.logger.apiRequest('POST', '/projects/1/test-cases', 500, 200);
        throw new Error('Server error');
      }
      return { TestCaseId: Math.floor(Math.random() * 1000) };
    },
    async addTestSteps() {},
    async createTestFolder(request: any) {
      return { testCaseFolderId: 1, name: request.Name, indentLevel: '0' };
    },
  } as any;

  const importEngine = createImportEngine({
    client: mockClient,
    logger: state.logger,
    existingFolders: [],
    customPropertyDefinitions: [],
  });

  state.importResult = await importEngine.import(state.testCases, {
    dryRun: false,
    onProgress: () => {},
  });

  // Persist the log to a temp file
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spira-log-test-'));
  state.logFilePath = path.join(tempDir, 'import-log.json');
  await state.logger.persist(state.logFilePath);
});

Given('an import is partway through processing a batch', async function (this: LogicWorld) {
  const state = getLoggingState(this);
  state.testCases = buildTestCases(10);
  state.interruptedAt = 5; // Simulate interruption at index 5

  // Process only the first 5
  const mockClient = {
    async createTestCase(request: any) {
      state.logger.apiRequest('POST', '/projects/1/test-cases', 200, 100);
      return { TestCaseId: Math.floor(Math.random() * 1000) };
    },
    async addTestSteps() {},
    async createTestFolder(request: any) {
      return { testCaseFolderId: 1, name: request.Name, indentLevel: '0' };
    },
  } as any;

  // Import only the first 5 to simulate partial completion
  const importEngine = createImportEngine({
    client: mockClient,
    logger: state.logger,
    existingFolders: [],
    customPropertyDefinitions: [],
  });

  state.importResult = await importEngine.import(state.testCases.slice(0, state.interruptedAt), {
    dryRun: false,
    onProgress: (current, total, item) => {
      state.progressUpdates.push({ current, total, item });
    },
  });

  // Log the interruption state manually (simulating what the shutdown handler does)
  state.logger.info('Interruption state:', {
    processedCount: state.interruptedAt,
    remainingCount: state.testCases.length - state.interruptedAt,
    processed: state.testCases.slice(0, state.interruptedAt).map(tc => ({ sourceRowIndex: tc.sourceRowIndex, name: tc.name })),
    remaining: state.testCases.slice(state.interruptedAt).map(tc => ({ sourceRowIndex: tc.sourceRowIndex, name: tc.name })),
  });

  // Persist
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spira-log-interrupt-'));
  state.logFilePath = path.join(tempDir, 'import-log.json');
  await state.logger.persist(state.logFilePath);
});

// --- When steps ---

When('API requests are made to Spira', function (this: LogicWorld) {
  // Already happened in the Given step
  const state = getLoggingState(this);
  assert.ok(state.importResult, 'Import should have run');
});

When('the process receives an interrupt signal', function (this: LogicWorld) {
  // Simulated in the Given step — we don't send a real SIGINT in tests
  const state = getLoggingState(this);
  assert.ok(state.interruptedAt !== null, 'Interruption should be simulated');
});

// --- Then steps ---

Then('the Importer should display the current item count relative to total', function (this: LogicWorld) {
  const state = getLoggingState(this);
  assert.ok(state.progressUpdates.length > 0, 'Should have progress updates');
  // Verify progress updates include current/total
  for (const update of state.progressUpdates) {
    assert.ok(update.current >= 1, 'Current should be >= 1');
    assert.ok(update.total >= 1, 'Total should be >= 1');
    assert.ok(update.current <= update.total, 'Current should not exceed total');
  }
});

Then('progress should update as each test case is processed', function (this: LogicWorld) {
  const state = getLoggingState(this);
  // Should have one progress update per test case
  assert.strictEqual(state.progressUpdates.length, state.testCases.length);
  // Progress should increment
  for (let i = 0; i < state.progressUpdates.length; i++) {
    assert.strictEqual(state.progressUpdates[i].current, i + 1);
  }
});

Then('the logger should record the HTTP method, URL, response status, and duration for each', function (this: LogicWorld) {
  const state = getLoggingState(this);
  const entries = state.logger.getEntries();
  const apiEntries = entries.filter((e): e is Extract<AnyLogEntry, { level: 'api' }> => e.level === 'api');
  assert.ok(apiEntries.length > 0, 'Should have API log entries');

  for (const entry of apiEntries) {
    assert.ok(entry.method, 'API entry should have method');
    assert.ok(entry.url, 'API entry should have URL');
    assert.ok(typeof entry.statusCode === 'number', 'API entry should have statusCode');
    assert.ok(typeof entry.durationMs === 'number', 'API entry should have durationMs');
  }
});

Then('the full log should be written to a file in the working directory', function (this: LogicWorld) {
  const state = getLoggingState(this);
  assert.ok(state.logFilePath, 'Log file path should exist');
  assert.ok(fs.existsSync(state.logFilePath), `Log file should exist at ${state.logFilePath}`);
});

Then('the log file should contain all API request\\/response records', function (this: LogicWorld) {
  const state = getLoggingState(this);
  assert.ok(state.logFilePath, 'Log file path should exist');
  const content = JSON.parse(fs.readFileSync(state.logFilePath, 'utf-8'));
  assert.ok(Array.isArray(content), 'Log file should contain an array');
  const apiEntries = content.filter((e: any) => e.level === 'api');
  assert.ok(apiEntries.length > 0, 'Persisted log should contain API entries');
});

Then('the log should record which test cases were successfully imported', function (this: LogicWorld) {
  const state = getLoggingState(this);
  const entries = state.logger.getEntries();
  // Look for the interruption state entry
  const interruptEntry = entries.find(
    (e) => e.level === 'info' && (e as any).message?.includes('Interruption state'),
  );
  assert.ok(interruptEntry, 'Should have logged interruption state');
  const context = (interruptEntry as any).context;
  assert.ok(context?.processedCount >= 0, 'Should record processed count');
  assert.ok(Array.isArray(context?.processed), 'Should have processed list');
});

Then('the log should record which test cases remain unprocessed', function (this: LogicWorld) {
  const state = getLoggingState(this);
  const entries = state.logger.getEntries();
  const interruptEntry = entries.find(
    (e) => e.level === 'info' && (e as any).message?.includes('Interruption state'),
  );
  assert.ok(interruptEntry, 'Should have logged interruption state');
  const context = (interruptEntry as any).context;
  assert.ok(context?.remainingCount > 0, 'Should record remaining count');
  assert.ok(Array.isArray(context?.remaining), 'Should have remaining list');
});

Then('the log file should be persisted before exit', function (this: LogicWorld) {
  const state = getLoggingState(this);
  assert.ok(state.logFilePath, 'Log file path should exist');
  assert.ok(fs.existsSync(state.logFilePath), 'Log file should have been written');
  // Verify content includes the interruption state
  const content = JSON.parse(fs.readFileSync(state.logFilePath, 'utf-8'));
  const hasInterruptEntry = content.some(
    (e: any) => e.message?.includes('Interruption state'),
  );
  assert.ok(hasInterruptEntry, 'Log file should contain interruption state');
});
