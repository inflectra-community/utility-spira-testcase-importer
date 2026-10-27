/**
 * Unit tests for the Zephyr resolution core.
 *
 * fuzzyMatchName is the 6-strategy cascade behind all Zephyr value resolution
 * and gap analysis. analyzeZephyrGaps builds the SpiraProvisioner input from a
 * parsed bundle. Both are pure and critical to the Zephyr path.
 */

import { describe, it, expect } from 'vitest';
import { fuzzyMatchName, analyzeZephyrGaps } from './pipeline-zephyr.js';
import type { TransformedTestCase } from './types/transform.js';
import type { TemplateMetadata } from './types/spira.js';

const named = (name: string) => ({ name });

describe('fuzzyMatchName', () => {
  const priorities = [
    { name: '1 - Critical', active: true },
    { name: '2 - High', active: true },
    { name: '3 - Medium', active: true },
    { name: '4 - Low', active: false },
  ];

  it('exact match (case-insensitive)', () => {
    expect(fuzzyMatchName('2 - high', priorities, p => p.name, p => p.active)?.name).toBe('2 - High');
  });

  it('target-contains-source: "High" → "2 - High"', () => {
    expect(fuzzyMatchName('High', priorities, p => p.name, p => p.active)?.name).toBe('2 - High');
  });

  it('source-contains-target: "Country Code" → "Country"', () => {
    const props = [named('Country'), named('Transaction Code')];
    expect(fuzzyMatchName('Country Code', props, p => p.name)?.name).toBe('Country');
  });

  it('suffix strip: "Country Code" matches "Country" even without contains', () => {
    const props = [named('Country')];
    expect(fuzzyMatchName('Country Code', props, p => p.name)?.name).toBe('Country');
  });

  it('respects the active predicate (inactive candidates excluded)', () => {
    // "Low" would match "4 - Low" but it's inactive → no match
    expect(fuzzyMatchName('Low', priorities, p => p.name, p => p.active)).toBeUndefined();
  });

  it('returns undefined when nothing matches', () => {
    expect(fuzzyMatchName('Showstopper', priorities, p => p.name, p => p.active)).toBeUndefined();
  });
});

// --- analyzeZephyrGaps ---

function metadata(overrides?: Partial<TemplateMetadata>): TemplateMetadata {
  return {
    projectId: 1,
    templateId: 1,
    priorities: [{ priorityId: 1, name: 'High', active: true, score: 1 }],
    statuses: [{ testCaseStatusId: 1, name: 'Draft', active: true }],
    types: [{ testCaseTypeId: 1, name: 'Functional', active: true, isDefault: true }],
    components: [{ componentId: 1, name: 'SD', active: true }],
    customProperties: [
      {
        customPropertyId: 1, propertyNumber: 1, name: 'Transaction Code',
        artifactTypeName: 'TestCase', customPropertyTypeId: 6, customPropertyTypeName: 'List',
        customListId: 10, isRequired: false,
      },
    ],
    customLists: new Map([[10, [{ customPropertyValueId: 1, name: 'VA01', active: true }]]]),
    users: [],
    existingFolders: [],
    ...overrides,
  };
}

/** Builds a test case carrying Zephyr metadata + named custom properties. */
function zephyrTc(
  key: string,
  customProps: { name: string; value: unknown }[],
  meta?: { priority?: string; status?: string; component?: string },
): TransformedTestCase {
  const tc: TransformedTestCase = {
    sourceRowIndex: 0,
    name: key,
    customProperties: customProps.map((c, i) => ({ propertyNumber: -(i + 1), value: c.value, name: c.name } as any)),
    testSteps: [],
  };
  (tc as any)._zephyrMeta = { key, ...(meta ?? {}) };
  return tc;
}

describe('analyzeZephyrGaps', () => {
  it('reports a custom property the template lacks as a new property', () => {
    const tcs = [zephyrTc('T1', [{ name: 'Country Code', value: 'DE' }])];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    // "Country Code" isn't in the template (only "Transaction Code" is) → new property
    expect(gaps.newProperties.map(p => p.name)).toContain('Country Code');
    expect(gaps.newProperties.find(p => p.name === 'Country Code')!.uniqueValues).toEqual(['DE']);
  });

  it('reports a value missing from an existing list property', () => {
    const tcs = [zephyrTc('T1', [{ name: 'Transaction Code', value: 'VL10B' }])];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    expect(gaps.missingListValues).toHaveLength(1);
    expect(gaps.missingListValues[0].propertyName).toBe('Transaction Code');
    expect(gaps.missingListValues[0].missingValues).toContain('VL10B');
  });

  it('does not report a value already present in the list', () => {
    const tcs = [zephyrTc('T1', [{ name: 'Transaction Code', value: 'VA01' }])];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    expect(gaps.missingListValues).toHaveLength(0);
  });

  it('flags unmatched priority/status/component as unprovisionable', () => {
    const tcs = [zephyrTc('T1', [], { priority: 'Blocker', component: 'XYZ' })];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    expect(gaps.unprovisionableLookups).toContain('Priority: Blocker');
    expect(gaps.unprovisionableLookups).toContain('Component: XYZ');
  });

  it('accumulates distinct values for a new property across test cases', () => {
    const tcs = [
      zephyrTc('T1', [{ name: 'Region', value: 'EMEA' }]),
      zephyrTc('T2', [{ name: 'Region', value: 'APAC' }]),
      zephyrTc('T3', [{ name: 'Region', value: 'EMEA' }]),
    ];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    const region = gaps.newProperties.find(p => p.name === 'Region')!;
    expect(region.uniqueValues.sort()).toEqual(['APAC', 'EMEA']);
  });

  it('reports no gaps when everything matches the template', () => {
    const tcs = [zephyrTc('T1', [{ name: 'Transaction Code', value: 'VA01' }], { priority: 'High', component: 'SD' })];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    expect(gaps.newProperties).toHaveLength(0);
    expect(gaps.missingListValues).toHaveLength(0);
    expect(gaps.unprovisionableLookups).toHaveLength(0);
  });
});
