/**
 * Unit tests for the data transformer — the transform-type behaviours and
 * test-step extraction edge cases that were listed as optional in the original
 * task plan and never written.
 */

import { describe, it, expect } from 'vitest';
import { createDataTransformer } from './index.js';
import type { MappingResult } from '../types/mapping.js';
import type { TemplateMetadata } from '../types/spira.js';

function metadata(): TemplateMetadata {
  return {
    projectId: 1, templateId: 1,
    priorities: [{ priorityId: 1, name: 'High', active: true, score: 1 }],
    statuses: [{ testCaseStatusId: 10, name: 'Draft', active: true }],
    types: [{ testCaseTypeId: 20, name: 'Functional', active: true, isDefault: true }],
    components: [], customProperties: [], customLists: new Map(), users: [], existingFolders: [],
  };
}

const transformer = createDataTransformer();

describe('direct transform', () => {
  it('copies source values unchanged to standard fields', () => {
    const rows = [{ Title: 'Login test', Desc: 'Verify login' }];
    const mapping: MappingResult = {
      fieldMappings: [
        { sourceColumn: 'Title', targetField: 'Name', transformType: 'direct' },
        { sourceColumn: 'Desc', targetField: 'Description', transformType: 'direct' },
      ],
      confidence: 1, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    const result = transformer.transform(rows, mapping, metadata());
    expect(result.testCases[0].name).toBe('Login test');
    expect(result.testCases[0].description).toBe('Verify login');
  });
});

describe('lookup transform', () => {
  const mapping: MappingResult = {
    fieldMappings: [
      { sourceColumn: 'Name', targetField: 'Name', transformType: 'direct' },
      { sourceColumn: 'Prio', targetField: 'TestCasePriorityId', transformType: 'lookup', lookupMap: { High: 1 } },
    ],
    confidence: 1, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
  };

  it('maps a source value through the lookup map to a Spira ID', () => {
    const result = transformer.transform([{ Name: 'TC', Prio: 'High' }], mapping, metadata());
    expect(result.testCases[0].testCasePriorityId).toBe(1);
  });

  it('records a warning and leaves the field unset when the value is not in the lookup map', () => {
    const result = transformer.transform([{ Name: 'TC', Prio: 'Nonexistent' }], mapping, metadata());
    expect(result.testCases[0].testCasePriorityId).toBeUndefined();
    // NOTE: the transformer records lookup misses in `errors` with severity
    // 'warning' (not in the separate `warnings` array). Documenting actual behaviour.
    const warningEntries = result.errors.filter(e => e.severity === 'warning' && e.field === 'TestCasePriorityId');
    expect(warningEntries.length).toBeGreaterThan(0);
  });

  it('matches lookup keys case-insensitively', () => {
    const result = transformer.transform([{ Name: 'TC', Prio: 'high' }], mapping, metadata());
    expect(result.testCases[0].testCasePriorityId).toBe(1);
  });
});

describe('template transform', () => {
  it('combines multiple columns via a {placeholder} pattern', () => {
    const rows = [{ Module: 'Auth', Feature: 'Login', Scenario: 'Valid creds' }];
    const mapping: MappingResult = {
      fieldMappings: [
        { sourceColumn: 'Module', targetField: 'Name', transformType: 'template', templatePattern: '{Module} > {Feature} > {Scenario}' },
      ],
      confidence: 1, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    const result = transformer.transform(rows, mapping, metadata());
    expect(result.testCases[0].name).toBe('Auth > Login > Valid creds');
  });
});

describe('ignore transform', () => {
  it('does not contribute ignored columns to the test case', () => {
    const rows = [{ Name: 'TC', Junk: 'should be dropped' }];
    const mapping: MappingResult = {
      fieldMappings: [
        { sourceColumn: 'Name', targetField: 'Name', transformType: 'direct' },
        { sourceColumn: 'Junk', targetField: 'ignore', transformType: 'ignore' },
      ],
      confidence: 1, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    const result = transformer.transform(rows, mapping, metadata());
    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0].name).toBe('TC');
  });
});

describe('inline test steps', () => {
  it('splits a delimited cell into ordered steps', () => {
    const rows = [{ Name: 'TC', Steps: 'Open app\nLog in\nVerify dashboard' }];
    const mapping: MappingResult = {
      fieldMappings: [{ sourceColumn: 'Name', targetField: 'Name', transformType: 'direct' }],
      testStepMapping: { mode: 'inline', descriptionColumn: 'Steps', stepDelimiter: '\n' },
      confidence: 1, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    const result = transformer.transform(rows, mapping, metadata());
    const steps = result.testCases[0].testSteps;
    expect(steps).toHaveLength(3);
    expect(steps[0].description).toBe('Open app');
    expect(steps[0].position).toBe(1);
    expect(steps[2].description).toBe('Verify dashboard');
  });
});

describe('one test case per row (no step grouping)', () => {
  it('produces one test case per source row', () => {
    const rows = [{ Name: 'A' }, { Name: 'B' }, { Name: 'C' }];
    const mapping: MappingResult = {
      fieldMappings: [{ sourceColumn: 'Name', targetField: 'Name', transformType: 'direct' }],
      confidence: 1, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    const result = transformer.transform(rows, mapping, metadata());
    expect(result.testCases.map(tc => tc.name)).toEqual(['A', 'B', 'C']);
  });
});
