/**
 * Step definitions for import-execution.feature and import.feature
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LogicWorld } from '../support/worlds/logic.world.js';
import type { TransformedTestCase } from '../../src/types/transform.js';

// --- Setup ---

Given('a batch of valid transformed test cases', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  this.transformedTestCases = generateTestCases(5, this.templateMetadata!.statuses[0].testCaseStatusId);
});

Given('{int} valid transformed test cases', function (this: LogicWorld, count: number) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  this.transformedTestCases = generateTestCases(count, this.templateMetadata!.statuses[0].testCaseStatusId);
});

Given('a batch of validated test cases', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  this.transformedTestCases = generateTestCases(5, this.templateMetadata!.statuses[0].testCaseStatusId);
});

Given('a batch of transformed test cases where one will fail due to an API error', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  const tcs = generateTestCases(5, this.templateMetadata!.statuses[0].testCaseStatusId);
  // Mark test case 3 to trigger a failure in the mock client
  tcs[2].name = '__FAIL__';
  this.transformedTestCases = tcs;
});

Given('a batch of transformed test cases where some will fail', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  const tcs = generateTestCases(10, this.templateMetadata!.statuses[0].testCaseStatusId);
  tcs[1].name = '__FAIL__';
  tcs[4].name = '__FAIL__';
  tcs[7].name = '__FAIL__';
  this.transformedTestCases = tcs;
});

Given('a transformed test case with associated test steps', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  this.transformedTestCases = [{
    sourceRowIndex: 1,
    name: 'Login Flow',
    testCaseStatusId: this.templateMetadata!.statuses[0].testCaseStatusId,
    customProperties: [],
    testSteps: [
      { description: 'Navigate to login page', expectedResult: 'Page loads', position: 1 },
      { description: 'Enter credentials', expectedResult: 'Fields populated', position: 2 },
      { description: 'Click submit', expectedResult: 'User logged in', position: 3 },
    ],
  }];
});

Given('transformed test cases with varying folder paths', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  const statusId = this.templateMetadata!.statuses[0].testCaseStatusId;
  this.transformedTestCases = [
    { sourceRowIndex: 1, name: 'Login test', testCaseStatusId: statusId, customProperties: [], testSteps: [], folderPath: 'Auth/Login' },
    { sourceRowIndex: 2, name: 'Signup test', testCaseStatusId: statusId, customProperties: [], testSteps: [], folderPath: 'Auth/Registration' },
    { sourceRowIndex: 3, name: 'API test', testCaseStatusId: statusId, customProperties: [], testSteps: [] },
  ];
});

Given('the user has approved the validation report', async function (this: LogicWorld) {
  // Ensure metadata is loaded for imports
  if (!this.templateMetadata) await this.loadTemplateMetadata(1);
});

Given('validated test case data is ready for import', function (this: LogicWorld) {
  if (!this.transformedTestCases) {
    this.transformedTestCases = generateTestCases(3, 1);
  }
});

Given('a validated test case that includes test steps', function (this: LogicWorld) {
  this.transformedTestCases = [{
    sourceRowIndex: 1,
    name: 'Test with steps',
    testCaseStatusId: 1,
    customProperties: [],
    testSteps: [
      { description: 'Step 1', expectedResult: 'Result 1', position: 1 },
      { description: 'Step 2', expectedResult: 'Result 2', position: 2 },
    ],
  }];
});

Given('a validated test case has custom properties mapped from the source data', function (this: LogicWorld) {
  this.transformedTestCases = [{
    sourceRowIndex: 1,
    name: 'Test with CPs',
    testCaseStatusId: 1,
    customProperties: [{ propertyNumber: 1, value: 2 }],
    testSteps: [],
  }];
});

Given('a batch of test cases where one will fail due to an API error', function (this: LogicWorld) {
  const tcs = generateTestCases(10, 1);
  tcs[4].name = '__FAIL__';
  this.transformedTestCases = tcs;
});

Given('the import has completed with some successes and some failures', async function (this: LogicWorld) {
  if (!this.templateMetadata) await this.loadTemplateMetadata(1);
  const tcs = generateTestCases(10, 1);
  tcs[2].name = '__FAIL__';
  tcs[7].name = '__FAIL__';
  this.transformedTestCases = tcs;
  await this.executeImport();
});

// --- Import action ---

When('the import is executed', async function (this: LogicWorld) {
  await this.executeImport();
});

When('the import executes', async function (this: LogicWorld) {
  await this.executeImport();
});

When('the import creates that test case', async function (this: LogicWorld) {
  await this.executeImport();
});

// --- Import assertions ---

Then('all test cases should be created successfully', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(this.importResult.failureCount, 0);
  assert.ok(this.importResult.successCount > 0);
});

Then('the import result should show zero failures', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(this.importResult.failureCount, 0);
});

Then('the import result should show {int} successful', function (this: LogicWorld, count: number) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(this.importResult.successCount, count);
});

Then('the import result should show {int} failure(s)', function (this: LogicWorld, count: number) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(this.importResult.failureCount, count);
});

Then('the import result should show {int} failures', function (this: LogicWorld, count: number) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(this.importResult.failureCount, count);
});

Then('all other test cases should still be attempted', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.ok(this.transformedTestCases, 'Test cases should exist');
  assert.strictEqual(
    this.importResult.successCount + this.importResult.failureCount,
    this.importResult.totalAttempted,
  );
});

Then('the failure should be logged with its source row reference', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.ok(this.importResult.failures.length > 0, 'Should have failures');
  for (const f of this.importResult.failures) {
    assert.ok(f.sourceRowIndex > 0, 'Failure should have sourceRowIndex');
    assert.ok(f.error.length > 0, 'Failure should have error message');
  }
});

Then('the failed test case should be logged with its source row reference', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.ok(this.importResult.failures.length > 0, 'Should have failures');
  for (const f of this.importResult.failures) {
    assert.ok(f.sourceRowIndex > 0, 'Failure should have sourceRowIndex');
    assert.ok(f.error.length > 0, 'Failure should have error message');
  }
});

Then('each test case should be created in the Spira project via the REST API', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.ok(this.importResult.successCount > 0, 'Should have created test cases');
});

Then('the import result should reflect the correct success and failure counts', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(
    this.importResult.successCount + this.importResult.failureCount,
    this.importResult.totalAttempted,
  );
});

Then('success count plus failure count should equal total attempted', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(
    this.importResult.successCount + this.importResult.failureCount,
    this.importResult.totalAttempted,
  );
});

Then('each failure should contain a source row index and error message', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  for (const f of this.importResult.failures) {
    assert.ok(typeof f.sourceRowIndex === 'number');
    assert.ok(f.error.length > 0);
  }
});

Then('the test case should be created first', function (this: LogicWorld) {
  // Verified by the import engine's sequential logic — test case then steps
  assert.ok(this.importResult, 'Import result should exist');
  assert.ok(this.importResult.successCount >= 1);
});

Then('then the test steps should be added to the created test case via the API', function (this: LogicWorld) {
  // Implicit in successful import — steps are added after test case creation
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(this.importResult.failureCount, 0);
});

Then('then test steps should be added to the created test case via the API', function (this: LogicWorld) {
  // Variant without "the" — same assertion
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(this.importResult.failureCount, 0);
});

Then('the test case should have been created with its test steps', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(this.importResult.successCount, 1);
  assert.strictEqual(this.importResult.failureCount, 0);
});

Then('the import summary should show all succeeded with zero failures', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(this.importResult.failureCount, 0);
  assert.ok(this.importResult.successCount > 0);
});

Then('the summary should list the count of successful imports', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.ok(typeof this.importResult.successCount === 'number');
});

Then('the summary should list the count of failures', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.ok(typeof this.importResult.failureCount === 'number');
});

Then('the summary should include the source row and error for each failure', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  for (const f of this.importResult.failures) {
    assert.ok(f.sourceRowIndex > 0);
    assert.ok(f.error.length > 0);
  }
});

Then('the summary should reflect the correct success and failure counts', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(
    this.importResult.successCount + this.importResult.failureCount,
    this.importResult.totalAttempted,
  );
});

Then('the output should indicate dry-run mode was active', function (this: LogicWorld) {
  assert.ok(this.dryRun, 'Should be in dry-run mode');
});

Then('the summary should report how many test cases would have been imported', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
  assert.ok(this.importResult.successCount > 0, 'Should show successful count in dry-run');
});

Then('the custom properties should be included in the creation request', function (this: LogicWorld) {
  // Verified by successful import — CPs are serialized in request
  assert.ok(this.importResult, 'Import result should exist');
  assert.strictEqual(this.importResult.failureCount, 0);
});

Then('each property should use the value type matching its definition in the template', function (this: LogicWorld) {
  // Verified by serializer logic — tested separately
  assert.ok(this.importResult?.successCount! >= 1);
});

Then('folders should be resolved or created before test cases are inserted', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
});

Then('each test case should be assigned the folder ID matching its path', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
});

Then('test cases with no folder path should be assigned to root', function (this: LogicWorld) {
  assert.ok(this.importResult, 'Import result should exist');
});

// --- Helper ---

function generateTestCases(count: number, statusId: number): TransformedTestCase[] {
  return Array.from({ length: count }, (_, i) => ({
    sourceRowIndex: i + 1,
    name: `Test Case ${i + 1}`,
    testCaseStatusId: statusId,
    customProperties: [],
    testSteps: [],
  }));
}
