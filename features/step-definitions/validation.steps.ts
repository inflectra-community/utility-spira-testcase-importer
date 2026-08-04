/**
 * Step definitions for validation.feature and validation-approval.feature
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LogicWorld } from '../support/worlds/logic.world.js';
import type { TransformedTestCase } from '../../src/types/transform.js';

// --- Setup transformed test cases ---

Given('transformed test cases with valid Names, valid status IDs, and valid priority IDs', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  const status = this.templateMetadata.statuses[0];
  const priority = this.templateMetadata.priorities[0];

  this.transformedTestCases = [
    buildTestCase({ name: 'Login test', statusId: status.testCaseStatusId, priorityId: priority.priorityId }),
    buildTestCase({ name: 'Logout test', statusId: status.testCaseStatusId, priorityId: priority.priorityId }),
  ];
});

Given('a transformed test case with an empty Name field', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  this.transformedTestCases = [
    buildTestCase({ name: '', statusId: this.templateMetadata.statuses[0].testCaseStatusId }),
  ];
});

Given('a transformed test case with a priority ID that does not exist in the template', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  this.transformedTestCases = [
    buildTestCase({ name: 'Test', statusId: this.templateMetadata.statuses[0].testCaseStatusId, priorityId: 99999 }),
  ];
});

Given('a transformed test case with a custom property value not matching any active list entry', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  this.transformedTestCases = [
    buildTestCase({
      name: 'Test',
      statusId: this.templateMetadata.statuses[0].testCaseStatusId,
      customProperties: [{ propertyNumber: 1, value: 99999 }],
    }),
  ];
});

Given('a transformed test case with a custom property value matching an active list entry', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  const listValues = this.templateMetadata.customLists.get(1);
  assert.ok(listValues && listValues.length > 0, 'Should have list values');
  this.transformedTestCases = [
    buildTestCase({
      name: 'Test',
      statusId: this.templateMetadata.statuses[0].testCaseStatusId,
      customProperties: [{ propertyNumber: 1, value: listValues[0].customPropertyValueId }],
    }),
  ];
});

Given('a transformed test case with an owner ID not found in the project user list', function (this: LogicWorld) {
  assert.ok(this.templateMetadata, 'Template metadata should be loaded');
  this.transformedTestCases = [
    buildTestCase({
      name: 'Test',
      statusId: this.templateMetadata.statuses[0].testCaseStatusId,
      ownerId: 99999,
    }),
  ];
});

// --- Validate action ---

When('the data is validated', async function (this: LogicWorld) {
  await this.validateData();
});

// --- Validation assertions ---

Then('the validation result should have zero errors', function (this: LogicWorld) {
  assert.ok(this.validationResult, 'Validation result should exist');
  assert.strictEqual(this.validationResult.errors.length, 0, `Expected 0 errors but got: ${JSON.stringify(this.validationResult.errors)}`);
});

Then('the validation result should have {int} error(s)', function (this: LogicWorld, count: number) {
  assert.ok(this.validationResult, 'Validation result should exist');
  assert.strictEqual(this.validationResult.errors.length, count);
});

Then('the validation result should have 0 errors', function (this: LogicWorld) {
  assert.ok(this.validationResult, 'Validation result should exist');
  assert.strictEqual(this.validationResult.errors.length, 0);
});

Then('the validation result should report an error', function (this: LogicWorld) {
  assert.ok(this.validationResult, 'Validation result should exist');
  assert.ok(this.validationResult.errors.length > 0, 'Should have at least one error');
});

Then('all test cases should be reported as valid', function (this: LogicWorld) {
  assert.ok(this.validationResult, 'Validation result should exist');
  assert.strictEqual(this.validationResult.stats.validTestCases, this.validationResult.stats.totalTestCases);
});

Then('the error should reference field {string}', function (this: LogicWorld, fieldName: string) {
  assert.ok(this.validationResult, 'Validation result should exist');
  const matchingError = this.validationResult.errors.find(e => e.field === fieldName);
  assert.ok(matchingError, `Should have error referencing field "${fieldName}". Errors: ${JSON.stringify(this.validationResult.errors)}`);
});

Then('the error should reference the custom property field', function (this: LogicWorld) {
  assert.ok(this.validationResult, 'Validation result should exist');
  const matchingError = this.validationResult.errors.find(e => e.field.startsWith('CustomProperty'));
  assert.ok(matchingError, `Should have error referencing a custom property field`);
});

Then('the error message should indicate the field is required', function (this: LogicWorld) {
  assert.ok(this.validationResult, 'Validation result should exist');
  const err = this.validationResult.errors[0];
  assert.ok(err.message.toLowerCase().includes('required') || err.message.toLowerCase().includes('empty'),
    `Error message should mention required: "${err.message}"`);
});

Then('the validation result should have zero errors for that property', function (this: LogicWorld) {
  assert.ok(this.validationResult, 'Validation result should exist');
  const cpErrors = this.validationResult.errors.filter(e => e.field.startsWith('CustomProperty'));
  assert.strictEqual(cpErrors.length, 0);
});

Then('the validation result should include a finding for the {string} field', function (this: LogicWorld, fieldName: string) {
  assert.ok(this.validationResult, 'Validation result should exist');
  const allFindings = [...this.validationResult.errors, ...this.validationResult.warnings];
  const match = allFindings.find(f => f.field === fieldName);
  assert.ok(match, `Should have a finding for field "${fieldName}"`);
});

// --- Helper ---

function buildTestCase(opts: {
  name: string;
  statusId?: number;
  priorityId?: number;
  ownerId?: number;
  customProperties?: { propertyNumber: number; value: unknown }[];
}): TransformedTestCase {
  return {
    sourceRowIndex: 1,
    name: opts.name,
    testCaseStatusId: opts.statusId,
    testCasePriorityId: opts.priorityId,
    ownerId: opts.ownerId,
    customProperties: (opts.customProperties ?? []) as any,
    testSteps: [],
  };
}
