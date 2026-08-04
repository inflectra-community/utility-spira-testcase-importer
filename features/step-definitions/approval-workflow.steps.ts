/**
 * Step definitions for approval-workflow.feature
 *
 * Exercises the report generator and validates the "no writes before approval" property.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LogicWorld } from '../support/worlds/logic.world.js';
import { generateValidationReport } from '../../src/report/index.js';
import type { TransformationResult, TransformedTestCase } from '../../src/types/transform.js';
import type { ValidationResult, ValidationError } from '../../src/types/validation.js';
import type { MappingResult } from '../../src/types/mapping.js';

// --- State scoped to approval-workflow scenarios ---

interface ApprovalState {
  transformResult: TransformationResult | null;
  validationResult: ValidationResult | null;
  mappingResult: MappingResult | null;
  report: string | null;
}

function getApprovalState(world: LogicWorld): ApprovalState {
  if (!(world as any).__approvalState) {
    (world as any).__approvalState = {
      transformResult: null,
      validationResult: null,
      mappingResult: null,
      report: null,
    } as ApprovalState;
  }
  return (world as any).__approvalState;
}

// --- Given steps ---

Given('a complete mapping and transformed data', function (this: LogicWorld) {
  // Set up transformed data but do NOT approve / import
  this.transformedTestCases = [
    { sourceRowIndex: 1, name: 'Test A', testCaseStatusId: 1, customProperties: [], testSteps: [] },
    { sourceRowIndex: 2, name: 'Test B', testCaseStatusId: 1, customProperties: [], testSteps: [] },
  ];
  this.dryRun = true; // Ensure no API calls happen
});

Given('the user has NOT approved the import', function (this: LogicWorld) {
  // Approval not given — import engine should NOT have been called
  // This is verified by the Then step checking no API writes
});

Given('a set of transformed test cases with some validation errors and warnings', function (this: LogicWorld) {
  const state = getApprovalState(this);

  const testCases: TransformedTestCase[] = [
    { sourceRowIndex: 1, name: 'Valid Test', testCaseStatusId: 1, customProperties: [], testSteps: [] },
    { sourceRowIndex: 2, name: '', testCaseStatusId: 1, customProperties: [], testSteps: [] },
    { sourceRowIndex: 3, name: 'Another Valid', testCaseStatusId: 1, customProperties: [{ propertyNumber: 1, value: 99999 }], testSteps: [] },
  ];

  state.transformResult = {
    testCases,
    errors: [],
    warnings: [],
  };

  state.validationResult = {
    isValid: false,
    errors: [
      { rowIndex: 2, field: 'Name', message: 'Name is required', severity: 'error' },
      { rowIndex: 3, field: 'CustomProperty_1', message: 'Invalid list value', severity: 'error' },
    ],
    warnings: [
      { rowIndex: 1, field: 'OwnerId', message: 'No owner assigned', severity: 'warning' },
    ],
    stats: {
      totalTestCases: 3,
      validTestCases: 1,
      totalTestSteps: 0,
      errorCount: 2,
      warningCount: 1,
    },
  };

  state.mappingResult = {
    fieldMappings: [
      { sourceColumn: 'Name', targetField: 'Name', transformType: 'direct' },
      { sourceColumn: 'Status', targetField: 'TestCaseStatusId', transformType: 'lookup', lookupMap: { Draft: 1 } },
    ],
    confidence: 0.85,
    unmappedSourceColumns: [],
    unmappedTargetFields: [],
    notes: [],
  };
});

Given('a confirmed mapping with multiple field mappings', function (this: LogicWorld) {
  const state = getApprovalState(this);

  state.mappingResult = {
    fieldMappings: [
      { sourceColumn: 'Test Name', targetField: 'Name', transformType: 'direct' },
      { sourceColumn: 'Priority', targetField: 'TestCasePriorityId', transformType: 'lookup', lookupMap: { High: 2, Low: 4 } },
      { sourceColumn: 'Description', targetField: 'Description', transformType: 'direct' },
      { sourceColumn: 'Owner', targetField: 'OwnerId', transformType: 'lookup', lookupMap: { 'John Smith': 1 } },
    ],
    confidence: 0.92,
    unmappedSourceColumns: ['Notes'],
    unmappedTargetFields: [],
    notes: [],
  };
});

Given('a set of transformed test cases with no validation errors', function (this: LogicWorld) {
  const state = getApprovalState(this);

  const testCases: TransformedTestCase[] = [
    { sourceRowIndex: 1, name: 'Test A', testCaseStatusId: 1, testCasePriorityId: 2, customProperties: [], testSteps: [] },
    { sourceRowIndex: 2, name: 'Test B', testCaseStatusId: 1, testCasePriorityId: 4, customProperties: [], testSteps: [] },
  ];

  state.transformResult = {
    testCases,
    errors: [],
    warnings: [],
  };

  state.validationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    stats: {
      totalTestCases: 2,
      validTestCases: 2,
      totalTestSteps: 0,
      errorCount: 0,
      warningCount: 0,
    },
  };
});

// --- When steps ---

When('the validation report is generated', function (this: LogicWorld) {
  const state = getApprovalState(this);
  assert.ok(state.transformResult, 'Transform result should exist');
  assert.ok(state.validationResult, 'Validation result should exist');
  assert.ok(state.mappingResult, 'Mapping result should exist');

  state.report = generateValidationReport(
    state.transformResult,
    state.validationResult,
    state.mappingResult,
  );
});

// --- Then steps ---

Then('the report total count should match the number of transformed test cases', function (this: LogicWorld) {
  const state = getApprovalState(this);
  assert.ok(state.report, 'Report should exist');
  const totalCount = state.transformResult!.testCases.length;
  assert.ok(
    state.report.includes(String(totalCount)),
    `Report should contain total count ${totalCount}`,
  );
});

Then('the report error count should match the number of validation errors', function (this: LogicWorld) {
  const state = getApprovalState(this);
  assert.ok(state.report, 'Report should exist');
  const errorCount = state.validationResult!.errors.length;
  assert.ok(
    state.report.includes(String(errorCount)),
    `Report should contain error count ${errorCount}`,
  );
});

Then('the report warning count should match the number of validation warnings', function (this: LogicWorld) {
  const state = getApprovalState(this);
  assert.ok(state.report, 'Report should exist');
  const warningCount = state.validationResult!.warnings.length;
  assert.ok(
    state.report.includes(String(warningCount)),
    `Report should contain warning count ${warningCount}`,
  );
});

Then('the report should include at least one sample record', function (this: LogicWorld) {
  const state = getApprovalState(this);
  assert.ok(state.report, 'Report should exist');
  assert.ok(
    state.report.includes('Sample Transformed Records'),
    'Report should have sample records section',
  );
  // Check it shows at least one record with Row reference
  assert.ok(state.report.includes('Row'), 'Report should reference at least one row');
});

Then('the report should include a field mapping summary', function (this: LogicWorld) {
  const state = getApprovalState(this);
  assert.ok(state.report, 'Report should exist');
  assert.ok(
    state.report.includes('Field Mapping Summary'),
    'Report should have field mapping summary section',
  );
});

Then('the field mapping summary should reference all confirmed mappings', function (this: LogicWorld) {
  const state = getApprovalState(this);
  assert.ok(state.report, 'Report should exist');
  assert.ok(state.mappingResult, 'Mapping result should exist');

  for (const fm of state.mappingResult.fieldMappings) {
    assert.ok(
      state.report.includes(fm.sourceColumn),
      `Report should reference source column "${fm.sourceColumn}"`,
    );
    assert.ok(
      state.report.includes(fm.targetField),
      `Report should reference target field "${fm.targetField}"`,
    );
  }
});
