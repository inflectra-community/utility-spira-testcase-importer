/**
 * Unit tests for the shared Excel mapping core.
 *
 * Covers the pure, adapter-agnostic logic that both the CLI and web server
 * rely on: converting a fully-resolved pre-analysis to a mapping, merging
 * heuristic results over an LLM mapping, resolving value suggestions to IDs,
 * and listing available targets for a field.
 */

import { describe, it, expect } from 'vitest';
import {
  convertPreAnalysisToMapping,
  mergeLookupMaps,
  mergeHeuristicsIntoMapping,
  processValueSuggestions,
  availableTargetsForField,
} from './excel-mapping.js';
import type { PreAnalysisResult } from '../heuristics/index.js';
import type { MappingResult } from '../types/mapping.js';
import type { TemplateMetadata } from '../types/spira.js';

function emptyStructure(): PreAnalysisResult['structure'] {
  return {
    stepStructure: { mode: 'none', confidence: 0 },
    folderStructure: { detected: false, confidence: 0 },
  };
}

function preAnalysis(overrides?: Partial<PreAnalysisResult>): PreAnalysisResult {
  return {
    resolvedMappings: [],
    valueLookups: new Map(),
    structure: emptyStructure(),
    unresolvedColumns: [],
    unresolvedValues: [],
    fullyResolved: false,
    summary: '',
    ...overrides,
  };
}

function metadata(overrides?: Partial<TemplateMetadata>): TemplateMetadata {
  return {
    projectId: 1,
    templateId: 1,
    priorities: [{ priorityId: 1, name: 'High', active: true, score: 1 }, { priorityId: 2, name: 'Low', active: true, score: 1 }],
    statuses: [{ testCaseStatusId: 10, name: 'Draft', active: true }],
    types: [{ testCaseTypeId: 20, name: 'Functional', active: true, isDefault: true }],
    components: [],
    customProperties: [
      { customPropertyId: 1, propertyNumber: 1, name: 'Environment', artifactTypeName: 'TestCase', customPropertyTypeId: 6, customPropertyTypeName: 'List', customListId: 30, isRequired: false },
    ],
    customLists: new Map([[30, [{ customPropertyValueId: 301, name: 'Production', active: true }, { customPropertyValueId: 302, name: 'Staging', active: true }]]]),
    users: [],
    existingFolders: [],
    ...overrides,
  };
}

describe('convertPreAnalysisToMapping', () => {
  it('maps resolved columns to direct field mappings', () => {
    const pa = preAnalysis({
      resolvedMappings: [{ sourceColumn: 'Title', targetField: 'Name', confidence: 1, tier: 1, matchReason: 'exact' }],
    });
    const m = convertPreAnalysisToMapping(pa);
    expect(m.fieldMappings).toContainEqual(expect.objectContaining({ sourceColumn: 'Title', targetField: 'Name', transformType: 'direct' }));
  });

  it('emits ignore mappings for __Ignore__ columns', () => {
    const pa = preAnalysis({
      resolvedMappings: [{ sourceColumn: 'Attachments', targetField: '__Ignore__', confidence: 1, tier: 1, matchReason: 'auto-ignore' }],
    });
    const m = convertPreAnalysisToMapping(pa);
    expect(m.fieldMappings).toContainEqual(expect.objectContaining({ sourceColumn: 'Attachments', transformType: 'ignore' }));
  });

  it('routes a detected folder column to folderMapping, not fieldMappings', () => {
    const pa = preAnalysis({
      resolvedMappings: [{ sourceColumn: 'Folder', targetField: '__FolderPath__', confidence: 1, tier: 1, matchReason: 'folder-alias' }],
      structure: { stepStructure: { mode: 'none', confidence: 0 }, folderStructure: { detected: true, column: 'Folder', separator: '/', confidence: 0.9 } },
    });
    const m = convertPreAnalysisToMapping(pa);
    expect(m.folderMapping).toEqual({ sourceColumn: 'Folder', pathSeparator: '/' });
    expect(m.fieldMappings.find(f => f.sourceColumn === 'Folder')).toBeUndefined();
  });

  it('uses lookup transform when a value lookup exists for the field', () => {
    const pa = preAnalysis({
      resolvedMappings: [{ sourceColumn: 'Priority', targetField: 'TestCasePriorityId', confidence: 1, tier: 1, matchReason: 'alias' }],
      valueLookups: new Map([['TestCasePriorityId', { High: 1 }]]),
    });
    const m = convertPreAnalysisToMapping(pa);
    const fm = m.fieldMappings.find(f => f.sourceColumn === 'Priority')!;
    expect(fm.transformType).toBe('lookup');
    expect(fm.lookupMap).toEqual({ High: 1 });
  });
});

describe('mergeLookupMaps', () => {
  it('overlays heuristic lookups onto lookup-type field mappings', () => {
    const mapping: MappingResult = {
      fieldMappings: [{ sourceColumn: 'Priority', targetField: 'TestCasePriorityId', transformType: 'lookup', lookupMap: { High: 99 } }],
      confidence: 0.8, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    const pa = preAnalysis({ valueLookups: new Map([['TestCasePriorityId', { High: 1, Low: 2 }]]) });
    mergeLookupMaps(mapping, pa);
    // Heuristic values win over the LLM's
    expect(mapping.fieldMappings[0].lookupMap).toEqual({ High: 1, Low: 2 });
  });
});

describe('mergeHeuristicsIntoMapping', () => {
  it('overrides an LLM field mapping with the heuristic answer for the same column', () => {
    const mapping: MappingResult = {
      fieldMappings: [{ sourceColumn: 'Title', targetField: 'Description', transformType: 'direct' }], // LLM got it wrong
      confidence: 0.6, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    const pa = preAnalysis({
      resolvedMappings: [{ sourceColumn: 'Title', targetField: 'Name', confidence: 1, tier: 1, matchReason: 'exact' }],
    });
    mergeHeuristicsIntoMapping(mapping, pa, metadata());
    const fm = mapping.fieldMappings.find(f => f.sourceColumn === 'Title')!;
    expect(fm.targetField).toBe('Name'); // heuristic wins
  });

  it('appends heuristic-resolved columns the LLM omitted', () => {
    const mapping: MappingResult = {
      fieldMappings: [], confidence: 0.6, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    const pa = preAnalysis({
      resolvedMappings: [{ sourceColumn: 'Owner', targetField: 'OwnerId', confidence: 1, tier: 1, matchReason: 'alias' }],
    });
    mergeHeuristicsIntoMapping(mapping, pa, metadata());
    expect(mapping.fieldMappings.find(f => f.sourceColumn === 'Owner')?.targetField).toBe('OwnerId');
  });

  it('removes step columns and applies testStepMapping from structure', () => {
    const mapping: MappingResult = {
      fieldMappings: [{ sourceColumn: 'Step Description', targetField: 'Description', transformType: 'direct' }],
      confidence: 0.6, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    const pa = preAnalysis({
      structure: {
        stepStructure: { mode: 'separate-rows', confidence: 0.9, groupingColumn: 'TC_ID', stepNumberColumn: 'Step', stepDescriptionColumn: 'Step Description', stepExpectedResultColumn: 'Expected' },
        folderStructure: { detected: false, confidence: 0 },
      },
    });
    mergeHeuristicsIntoMapping(mapping, pa, metadata());
    expect(mapping.fieldMappings.find(f => f.sourceColumn === 'Step Description')).toBeUndefined();
    expect(mapping.testStepMapping?.mode).toBe('separate-rows');
    expect(mapping.testStepMapping?.descriptionColumn).toBe('Step Description');
  });
});

describe('processValueSuggestions', () => {
  it('resolves a suggested priority name to its ID and folds it into the lookup', () => {
    const mapping: MappingResult = {
      fieldMappings: [{ sourceColumn: 'Prio', targetField: 'TestCasePriorityId', transformType: 'direct' }],
      valueSuggestions: [{ field: 'TestCasePriorityId', sourceValue: 'Urgent', suggestedTarget: 'High' }],
      confidence: 0.8, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    processValueSuggestions(mapping, metadata());
    const fm = mapping.fieldMappings[0];
    expect(fm.transformType).toBe('lookup');
    expect(fm.lookupMap).toEqual({ Urgent: 1 });
  });

  it('skips suggestions marked SKIP', () => {
    const mapping: MappingResult = {
      fieldMappings: [{ sourceColumn: 'Prio', targetField: 'TestCasePriorityId', transformType: 'direct' }],
      valueSuggestions: [{ field: 'TestCasePriorityId', sourceValue: 'Mystery', suggestedTarget: 'SKIP' }],
      confidence: 0.8, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    processValueSuggestions(mapping, metadata());
    expect(mapping.fieldMappings[0].lookupMap).toBeUndefined();
  });

  it('resolves a custom-property list value by name', () => {
    const mapping: MappingResult = {
      fieldMappings: [{ sourceColumn: 'Env', targetField: 'Environment', transformType: 'direct' }],
      valueSuggestions: [{ field: 'Environment', sourceValue: 'prod', suggestedTarget: 'Production' }],
      confidence: 0.8, unmappedSourceColumns: [], unmappedTargetFields: [], notes: [],
    };
    processValueSuggestions(mapping, metadata());
    expect(mapping.fieldMappings[0].lookupMap).toEqual({ prod: 301 });
  });
});

describe('availableTargetsForField', () => {
  it('returns priority names', () => {
    expect(availableTargetsForField('TestCasePriorityId', metadata())).toEqual(['High', 'Low']);
  });
  it('returns custom-property list values', () => {
    expect(availableTargetsForField('Environment', metadata())).toEqual(['Production', 'Staging']);
  });
  it('returns an empty array for an unknown field', () => {
    expect(availableTargetsForField('Nonexistent', metadata())).toEqual([]);
  });
});
