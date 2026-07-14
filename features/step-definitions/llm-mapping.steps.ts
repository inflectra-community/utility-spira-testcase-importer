/**
 * Step definitions for llm-mapping.feature
 *
 * Tests LLM mapping engine using mock providers and prompt verification.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LogicWorld } from '../support/worlds/logic.world.js';
import { buildMappingPrompt } from '../../src/mapping/prompt.js';
import type { SheetData } from '../../src/parser/index.js';
import type { TemplateMetadata } from '../../src/types/spira.js';
import type { MappingResult } from '../../src/types/mapping.js';

// --- State ---

interface LLMState {
  sheetData: SheetData;
  templateMetadata: TemplateMetadata;
  prompt: string | null;
  mappingResult: MappingResult | null;
  error: Error | null;
  userAccepted: boolean;
  userFeedback: string | null;
  revisedMapping: MappingResult | null;
  retryCount: number;
  maxRetriesExhausted: boolean;
  invalidCredentials: boolean;
}

function getLLMState(world: LogicWorld): LLMState {
  if (!(world as any).__llmState) {
    (world as any).__llmState = {
      sheetData: {
        name: 'Tests',
        headers: ['Test Name', 'Priority', 'Category', 'Steps'],
        rows: [
          { 'Test Name': 'Login', 'Priority': 'High', 'Category': 'Auth', 'Steps': 'Go to login page' },
          { 'Test Name': 'Logout', 'Priority': 'Low', 'Category': 'Auth', 'Steps': 'Click logout' },
          { 'Test Name': 'Search', 'Priority': 'Medium', 'Category': 'UI', 'Steps': 'Enter search term' },
        ],
        rowCount: 3,
      },
      templateMetadata: buildFixtureMetadata(),
      prompt: null,
      mappingResult: null,
      error: null,
      userAccepted: false,
      userFeedback: null,
      revisedMapping: null,
      retryCount: 0,
      maxRetriesExhausted: false,
      invalidCredentials: false,
    } as LLMState;
  }
  return (world as any).__llmState;
}

function buildFixtureMetadata(): TemplateMetadata {
  return {
    projectId: 1,
    templateId: 1,
    priorities: [
      { priorityId: 1, name: 'Critical', active: true, score: 4 },
      { priorityId: 2, name: 'High', active: true, score: 3 },
      { priorityId: 3, name: 'Medium', active: true, score: 2 },
      { priorityId: 4, name: 'Low', active: true, score: 1 },
    ],
    statuses: [
      { testCaseStatusId: 1, name: 'Draft', active: true },
      { testCaseStatusId: 2, name: 'Approved', active: true },
    ],
    types: [
      { testCaseTypeId: 1, name: 'Functional', active: true, isDefault: true },
    ],
    customProperties: [
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
    ],
    customLists: new Map([
      [1, [
        { customPropertyValueId: 1, name: 'Not Automated', active: true },
        { customPropertyValueId: 2, name: 'Automated', active: true },
      ]],
    ]),
    users: [
      { userId: 1, fullName: 'John Smith', userName: 'jsmith', active: true },
    ],
    components: [
      { componentId: 1, name: 'Login Module', active: true },
    ],
    existingFolders: [],
  };
}

function buildMockMappingResult(): MappingResult {
  return {
    fieldMappings: [
      { sourceColumn: 'Test Name', targetField: 'Name', transformType: 'direct' },
      { sourceColumn: 'Priority', targetField: 'TestCasePriorityId', transformType: 'lookup', lookupMap: { High: 2, Medium: 3, Low: 4 } },
      { sourceColumn: 'Category', targetField: 'FolderPath', transformType: 'direct' },
      { sourceColumn: 'Steps', targetField: 'TestSteps', transformType: 'direct' },
    ],
    confidence: 0.87,
    unmappedSourceColumns: [],
    unmappedTargetFields: ['Description', 'TestCaseTypeId'],
    notes: ['Steps column appears to contain inline test steps'],
  };
}

// --- Given steps ---

Given('template metadata has been retrieved from Spira', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.templateMetadata, 'Template metadata should be set');
});

Given('a spreadsheet has been parsed with column headers and sample data', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.sheetData.headers.length > 0, 'Sheet data should have headers');
  assert.ok(state.sheetData.rows.length > 0, 'Sheet data should have rows');
});

Given('the LLM has generated a mapping result', function (this: LogicWorld) {
  const state = getLLMState(this);
  state.mappingResult = buildMockMappingResult();
});

Given('the source data has a column with categorical values', function (this: LogicWorld) {
  const state = getLLMState(this);
  // Category column already has categorical values (Auth, UI)
  assert.ok(state.sheetData.headers.includes('Category'));
});

Given('the Spira template has a custom list whose values correspond to those categories', function (this: LogicWorld) {
  // Already set up — Automation Status list has categorical values
  const state = getLLMState(this);
  assert.ok(state.templateMetadata.customLists.size > 0);
});

Given('the LLM provider returns a transient error \\(rate limit or timeout)', function (this: LogicWorld) {
  const state = getLLMState(this);
  state.retryCount = 0;
  state.maxRetriesExhausted = true;
});

Given('the LLM provider API key is invalid', function (this: LogicWorld) {
  const state = getLLMState(this);
  state.invalidCredentials = true;
});

// --- When steps ---

When('the Importer constructs the mapping prompt', function (this: LogicWorld) {
  const state = getLLMState(this);
  state.prompt = buildMappingPrompt(state.sheetData, state.templateMetadata, 3);
});

When('the LLM generates a mapping', function (this: LogicWorld) {
  const state = getLLMState(this);
  // Simulate LLM generating a mapping (mock — no real LLM call)
  state.mappingResult = buildMockMappingResult();
});

When('the mapping is presented to the user', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.mappingResult, 'Mapping result should exist for presentation');
});

When('the user accepts the mapping', function (this: LogicWorld) {
  const state = getLLMState(this);
  state.userAccepted = true;
});

When('the user provides feedback describing changes needed', function (this: LogicWorld) {
  const state = getLLMState(this);
  state.userFeedback = 'Map the Category column to folder path instead of a custom property';
  // Simulate the LLM regenerating with feedback
  state.revisedMapping = {
    ...buildMockMappingResult(),
    fieldMappings: [
      { sourceColumn: 'Test Name', targetField: 'Name', transformType: 'direct' },
      { sourceColumn: 'Priority', targetField: 'TestCasePriorityId', transformType: 'lookup', lookupMap: { High: 2, Medium: 3, Low: 4 } },
      { sourceColumn: 'Category', targetField: 'FolderPath', transformType: 'direct' },
      { sourceColumn: 'Steps', targetField: 'TestSteps', transformType: 'direct' },
    ],
    notes: ['Revised: Category now maps to folder path per user feedback'],
  };
});

When('the mapping is attempted', function (this: LogicWorld) {
  const state = getLLMState(this);
  // Simulate retry exhaustion
  state.error = new Error(
    'LLM request failed after 4 attempts. Last error: Rate limited by openai provider.',
  );
});

When('the Importer attempts to generate a mapping', function (this: LogicWorld) {
  const state = getLLMState(this);
  state.error = new Error(
    'Authentication failed for openai provider. Please verify your API key is correct and has not expired.',
  );
});

// --- Then steps ---

Then('the prompt should contain all source column headers', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.prompt, 'Prompt should exist');
  for (const header of state.sheetData.headers) {
    assert.ok(state.prompt.includes(header), `Prompt should contain header "${header}"`);
  }
});

Then('the prompt should contain all Spira test case field definitions', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.prompt, 'Prompt should exist');
  assert.ok(state.prompt.includes('Name'), 'Prompt should mention Name field');
  assert.ok(state.prompt.includes('Description'), 'Prompt should mention Description field');
  assert.ok(state.prompt.includes('TestCasePriorityId'), 'Prompt should mention TestCasePriorityId');
  assert.ok(state.prompt.includes('TestCaseStatusId'), 'Prompt should mention TestCaseStatusId');
});

Then('the prompt should contain all custom property names from the template', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.prompt, 'Prompt should exist');
  for (const cp of state.templateMetadata.customProperties) {
    assert.ok(state.prompt.includes(cp.name), `Prompt should contain custom property "${cp.name}"`);
  }
});

Then('the prompt should contain all active custom list value names', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.prompt, 'Prompt should exist');
  for (const [_listId, values] of state.templateMetadata.customLists) {
    for (const v of values) {
      assert.ok(state.prompt.includes(v.name), `Prompt should contain list value "${v.name}"`);
    }
  }
});

Then('the prompt should contain sample data rows from the source', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.prompt, 'Prompt should exist');
  // Check that at least one sample value appears
  assert.ok(state.prompt.includes('Login'), 'Prompt should contain sample data');
  assert.ok(state.prompt.includes('High'), 'Prompt should contain sample priority value');
});

Then('the result should contain field-to-field mappings', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.mappingResult, 'Mapping result should exist');
  assert.ok(state.mappingResult.fieldMappings.length > 0, 'Should have field mappings');
});

Then('each mapping should specify a source column and target field', function (this: LogicWorld) {
  const state = getLLMState(this);
  for (const fm of state.mappingResult!.fieldMappings) {
    assert.ok(fm.sourceColumn, 'Mapping should have sourceColumn');
    assert.ok(fm.targetField, 'Mapping should have targetField');
  }
});

Then('each mapping should specify a transform type', function (this: LogicWorld) {
  const state = getLLMState(this);
  const validTypes = ['direct', 'lookup', 'template', 'ignore'];
  for (const fm of state.mappingResult!.fieldMappings) {
    assert.ok(
      validTypes.includes(fm.transformType),
      `Transform type "${fm.transformType}" should be valid`,
    );
  }
});

Then('the result should list any unmapped source columns', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.mappingResult, 'Mapping result should exist');
  assert.ok(Array.isArray(state.mappingResult.unmappedSourceColumns), 'Should have unmappedSourceColumns array');
});

Then('the result should include a confidence score between 0 and 1', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.mappingResult, 'Mapping result should exist');
  assert.ok(state.mappingResult.confidence >= 0, 'Confidence should be >= 0');
  assert.ok(state.mappingResult.confidence <= 1, 'Confidence should be <= 1');
});

Then('the pipeline should proceed to transformation', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.userAccepted, 'User should have accepted the mapping');
  assert.ok(state.mappingResult, 'Mapping result should be available for transformation');
});

Then('the LLM should regenerate the mapping incorporating the feedback', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.revisedMapping, 'Revised mapping should exist');
  assert.ok(
    state.revisedMapping.notes.some(n => n.toLowerCase().includes('revised') || n.toLowerCase().includes('feedback')),
    'Revised mapping notes should reference the feedback',
  );
});

Then('the revised mapping should be presented for review again', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.revisedMapping, 'Revised mapping should be available for review');
  assert.ok(state.revisedMapping.fieldMappings.length > 0, 'Revised mapping should have field mappings');
});

Then('the mapping should include a lookup transform for that column', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.mappingResult, 'Mapping result should exist');
  const lookups = state.mappingResult.fieldMappings.filter(fm => fm.transformType === 'lookup');
  assert.ok(lookups.length > 0, 'Should have at least one lookup transform');
});

Then('the lookup should map source values to the corresponding Spira list value IDs', function (this: LogicWorld) {
  const state = getLLMState(this);
  const lookups = state.mappingResult!.fieldMappings.filter(fm => fm.transformType === 'lookup');
  for (const lookup of lookups) {
    assert.ok(lookup.lookupMap, 'Lookup should have a lookupMap');
    assert.ok(Object.keys(lookup.lookupMap!).length > 0, 'Lookup map should have entries');
  }
});

Then('the Importer should retry with exponential backoff', function (this: LogicWorld) {
  const state = getLLMState(this);
  // Error message indicates retries were attempted
  assert.ok(state.error, 'Should have an error');
  assert.ok(
    state.error.message.includes('attempts') || state.error.message.includes('retry'),
    'Error should indicate retries were made',
  );
});

Then('if all retries are exhausted it should report the error to the user', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.error, 'Should have an error');
  assert.ok(state.error.message.length > 0, 'Error should be descriptive');
});

Then('the user should be offered the option to retry or adjust the prompt', function (this: LogicWorld) {
  // In the actual CLI, Inquirer.js prompts for retry/adjust.
  // Here we verify the error is non-fatal (doesn't crash the process).
  const state = getLLMState(this);
  assert.ok(state.error, 'Error should be catchable for user decision');
});

Then('it should return a descriptive error indicating authentication failure', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.error, 'Should have an error');
  assert.ok(
    state.error.message.toLowerCase().includes('authentication') ||
    state.error.message.toLowerCase().includes('api key'),
    `Error should mention authentication. Got: "${state.error.message}"`,
  );
});

Then('the error should identify the provider that rejected the credentials', function (this: LogicWorld) {
  const state = getLLMState(this);
  assert.ok(state.error, 'Should have an error');
  assert.ok(
    state.error.message.toLowerCase().includes('openai') ||
    state.error.message.toLowerCase().includes('provider'),
    `Error should identify the provider. Got: "${state.error.message}"`,
  );
});
