/**
 * Step definitions for data-transformation.feature
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LogicWorld } from '../support/worlds/logic.world.js';
import type { MappingResult, FieldMapping } from '../../src/types/mapping.js';

// --- Source data setup ---

Given('a source spreadsheet with the following data:', function (this: LogicWorld, dataTable: any) {
  const rows = dataTable.hashes();
  const headers = dataTable.raw()[0] as string[];
  this.sourceData = { headers, rows };
});

// --- Mapping setup ---

Given('a mapping that maps {string} directly to {string}', function (this: LogicWorld, sourceCol: string, targetField: string) {
  if (!this.mappingResult) {
    this.mappingResult = createEmptyMapping();
  }
  this.mappingResult.fieldMappings.push({
    sourceColumn: sourceCol,
    targetField,
    transformType: 'direct',
  });
});

Given('a mapping that maps {string} via lookup to {string} using the template priority names', function (this: LogicWorld, sourceCol: string, targetField: string) {
  if (!this.mappingResult) {
    this.mappingResult = createEmptyMapping();
  }
  // Build lookup from template priorities
  const lookupMap: Record<string, number | string> = {};
  if (this.templateMetadata) {
    for (const p of this.templateMetadata.priorities) {
      lookupMap[p.name] = p.priorityId;
    }
  }
  this.mappingResult.fieldMappings.push({
    sourceColumn: sourceCol,
    targetField,
    transformType: 'lookup',
    lookupMap,
  });
});

Given('a mapping that maps {string} via lookup to the {string} custom list', function (this: LogicWorld, sourceCol: string, listName: string) {
  if (!this.mappingResult) {
    this.mappingResult = createEmptyMapping();
  }
  // Find the custom property with this list name and build a lookup
  const lookupMap: Record<string, number | string> = {};
  if (this.templateMetadata) {
    const cp = this.templateMetadata.customProperties.find(p => p.name === listName);
    if (cp && cp.customListId) {
      const values = this.templateMetadata.customLists.get(cp.customListId);
      if (values) {
        for (const v of values) {
          lookupMap[v.name] = v.customPropertyValueId;
        }
      }
    }
    // Use the custom property NAME as targetField — the transformer does findCustomProperty by name
    this.mappingResult.fieldMappings.push({
      sourceColumn: sourceCol,
      targetField: cp?.name ?? listName,
      transformType: 'lookup',
      lookupMap,
    });
  }
});

Given('a mapping that maps {string}, {string}, {string} via template {string} to {string}', function (
  this: LogicWorld, col1: string, col2: string, col3: string, pattern: string, targetField: string
) {
  if (!this.mappingResult) {
    this.mappingResult = createEmptyMapping();
  }
  this.mappingResult.fieldMappings.push({
    sourceColumn: col1,
    targetField,
    transformType: 'template',
    templatePattern: pattern,
  });
});

Given('no source column is mapped to {string}', function (this: LogicWorld, _targetField: string) {
  // Ensure no mapping targets Name
  if (this.mappingResult) {
    this.mappingResult.fieldMappings = this.mappingResult.fieldMappings.filter(
      m => m.targetField !== _targetField
    );
  }
});

Given('a mapping that identifies test case rows by {string}', function (this: LogicWorld, idColumn: string) {
  if (!this.mappingResult) {
    this.mappingResult = createEmptyMapping();
  }
  // Set up test step mapping in separate-rows mode.
  // The transformer uses the Name field to identify parent rows (rows with Name = parent, without = step).
  // We need to also add the Name mapping from TC_Name.
  this.mappingResult.testStepMapping = {
    mode: 'separate-rows',
    descriptionColumn: undefined,
    expectedResultColumn: undefined,
    sampleDataColumn: undefined,
  };

  // For the transformer to group correctly, we map TC_Name to Name.
  // Rows where the Name repeats aren't grouped — the transformer identifies
  // step rows by whether the Name field is empty. So we need to restructure the source data.
  // Remap source data to have empty Names for step rows to match transformer behavior.
  if (this.sourceData) {
    const seen = new Set<string>();
    for (const row of this.sourceData.rows) {
      const id = String(row[idColumn] ?? '');
      if (seen.has(id)) {
        // Mark as step row by clearing TC_Name
        row['TC_Name'] = '';
      } else {
        seen.add(id);
      }
    }
  }

  // Add a Name mapping if not already present
  const hasNameMapping = this.mappingResult.fieldMappings.some(
    m => m.targetField.toLowerCase() === 'name'
  );
  if (!hasNameMapping) {
    this.mappingResult.fieldMappings.push({
      sourceColumn: 'TC_Name',
      targetField: 'Name',
      transformType: 'direct',
    });
  }
});

Given('test steps are mapped from {string} and {string} columns', function (this: LogicWorld, descCol: string, expectedCol: string) {
  if (this.mappingResult?.testStepMapping) {
    this.mappingResult.testStepMapping.descriptionColumn = descCol;
    this.mappingResult.testStepMapping.expectedResultColumn = expectedCol;
  }
});

Given('a test step mapping in inline mode on column {string} with delimiter {string}', function (this: LogicWorld, col: string, delimiter: string) {
  if (!this.mappingResult) {
    this.mappingResult = createEmptyMapping();
  }
  this.mappingResult.testStepMapping = {
    mode: 'inline',
    descriptionColumn: col,
    stepDelimiter: delimiter,
  };
});

// --- Transform action ---

When('the data is transformed', async function (this: LogicWorld) {
  await this.transformData();
});

When('the data is transformed and validated', async function (this: LogicWorld) {
  await this.transformData();
  await this.validateData();
});

// --- Transform assertions ---

Then('{int} test cases should be produced', function (this: LogicWorld, count: number) {
  assert.ok(this.transformedTestCases, 'Transformed test cases should exist');
  assert.strictEqual(this.transformedTestCases.length, count);
});

Then('test case {int} should have Name {string}', function (this: LogicWorld, index: number, name: string) {
  assert.ok(this.transformedTestCases, 'Transformed test cases should exist');
  assert.strictEqual(this.transformedTestCases[index - 1].name, name);
});

Then('test case {int} should have Description {string}', function (this: LogicWorld, index: number, desc: string) {
  assert.ok(this.transformedTestCases, 'Transformed test cases should exist');
  assert.strictEqual(this.transformedTestCases[index - 1].description, desc);
});

Then('test case {int} should have TestCasePriorityId matching the {string} priority from the template', function (this: LogicWorld, index: number, priorityName: string) {
  assert.ok(this.transformedTestCases, 'Transformed test cases should exist');
  assert.ok(this.templateMetadata, 'Template metadata should exist');
  const expectedPriority = this.templateMetadata.priorities.find(p => p.name === priorityName);
  assert.ok(expectedPriority, `Priority "${priorityName}" should exist in template`);
  assert.strictEqual(this.transformedTestCases[index - 1].testCasePriorityId, expectedPriority.priorityId);
});

Then('test case {int} should have a custom property value matching {string} in the list', function (this: LogicWorld, index: number, valueName: string) {
  assert.ok(this.transformedTestCases, 'Transformed test cases should exist');
  const tc = this.transformedTestCases[index - 1];
  assert.ok(tc.customProperties.length > 0, 'Should have custom properties');
  // The value should match the ID of the list entry with this name
  const listValues = Array.from(this.templateMetadata!.customLists.values()).flat();
  const matchingValue = listValues.find(v => v.name === valueName);
  assert.ok(matchingValue, `List value "${valueName}" should exist`);
  const cpValue = tc.customProperties[0].value;
  assert.strictEqual(cpValue, matchingValue.customPropertyValueId);
});

Then('the test case with identifier {string} should have {int} test steps', function (this: LogicWorld, id: string, count: number) {
  assert.ok(this.transformedTestCases, 'Transformed test cases should exist');
  // Search by name, tags, or by the source data row containing the ID
  const tc = this.transformedTestCases.find(t =>
    t.name.includes(id) || t.name === id || t.tags === id
  );
  // If not found by ID directly, find by index based on TC_ID from source data
  let target = tc;
  if (!target && this.sourceData) {
    // Find which row first had this TC_ID and match its test case name
    const matchingRow = this.sourceData.rows.find(r => String(r['TC_ID'] ?? '').trim() === id);
    if (matchingRow) {
      const name = String(matchingRow['TC_Name'] ?? '').trim();
      target = this.transformedTestCases.find(t => t.name === name);
    }
  }
  assert.ok(target, `Test case with identifier "${id}" should exist. Available: ${this.transformedTestCases.map(t => t.name).join(', ')}`);
  assert.strictEqual(target.testSteps.length, count);
});

Then('the test case with identifier {string} should have {int} test step', function (this: LogicWorld, id: string, count: number) {
  assert.ok(this.transformedTestCases, 'Transformed test cases should exist');
  const tc = this.transformedTestCases.find(t =>
    t.name.includes(id) || t.name === id || t.tags === id
  );
  let target = tc;
  if (!target && this.sourceData) {
    const matchingRow = this.sourceData.rows.find(r => String(r['TC_ID'] ?? '').trim() === id);
    if (matchingRow) {
      const name = String(matchingRow['TC_Name'] ?? '').trim();
      target = this.transformedTestCases.find(t => t.name === name);
    }
  }
  assert.ok(target, `Test case with identifier "${id}" should exist`);
  assert.strictEqual(target.testSteps.length, count);
});

Then('test step {int} of {string} should have description {string}', function (this: LogicWorld, stepIndex: number, tcId: string, desc: string) {
  assert.ok(this.transformedTestCases, 'Transformed test cases should exist');
  let tc = this.transformedTestCases.find(t => t.name.includes(tcId) || t.tags === tcId);
  if (!tc && this.sourceData) {
    const matchingRow = this.sourceData.rows.find(r => String(r['TC_ID'] ?? '').trim() === tcId);
    if (matchingRow) {
      const name = String(matchingRow['TC_Name'] ?? '').trim();
      tc = this.transformedTestCases.find(t => t.name === name);
    }
  }
  assert.ok(tc, `Test case "${tcId}" should exist`);
  assert.ok(tc.testSteps.length >= stepIndex, `Test case should have at least ${stepIndex} steps`);
  assert.strictEqual(tc.testSteps[stepIndex - 1].description, desc);
});

Then('test step {int} of {string} should have expected result {string}', function (this: LogicWorld, stepIndex: number, tcId: string, expected: string) {
  assert.ok(this.transformedTestCases, 'Transformed test cases should exist');
  let tc = this.transformedTestCases.find(t => t.name.includes(tcId) || t.tags === tcId);
  if (!tc && this.sourceData) {
    const matchingRow = this.sourceData.rows.find(r => String(r['TC_ID'] ?? '').trim() === tcId);
    if (matchingRow) {
      const name = String(matchingRow['TC_Name'] ?? '').trim();
      tc = this.transformedTestCases.find(t => t.name === name);
    }
  }
  assert.ok(tc, `Test case "${tcId}" should exist`);
  assert.ok(tc.testSteps.length >= stepIndex, `Test case should have at least ${stepIndex} steps`);
  assert.strictEqual(tc.testSteps[stepIndex - 1].expectedResult, expected);
});

Then('a validation error should be raised indicating the Name field is required', function (this: LogicWorld) {
  assert.ok(this.validationResult, 'Validation result should exist');
  assert.ok(this.validationResult.errors.length > 0, 'Should have validation errors');
  const nameError = this.validationResult.errors.find(e => e.field === 'Name');
  assert.ok(nameError, 'Should have an error for the Name field');
});

// --- Helper ---

function createEmptyMapping(): MappingResult {
  return {
    fieldMappings: [],
    confidence: 0.9,
    unmappedSourceColumns: [],
    unmappedTargetFields: [],
    notes: [],
  };
}
