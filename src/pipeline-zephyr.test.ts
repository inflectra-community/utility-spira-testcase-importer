/**
 * Unit tests for the Zephyr resolution core.
 *
 * fuzzyMatchName is the 6-strategy cascade behind all Zephyr value resolution
 * and gap analysis. analyzeZephyrGaps builds the SpiraProvisioner input from a
 * parsed bundle. Both are pure and critical to the Zephyr path.
 */

import { describe, it, expect } from 'vitest';
import {
  fuzzyMatchName,
  analyzeZephyrGaps,
  resolveZephyrMetadata,
  splitMultiValue,
  listValueKey,
  matchListValue,
} from './pipeline-zephyr.js';
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

  it('flags an unmatched priority as unprovisionable', () => {
    const tcs = [zephyrTc('T1', [], { priority: 'Blocker' })];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    expect(gaps.unprovisionableLookups).toContain('Priority: Blocker');
  });

  it('surfaces an unmatched component in its own missingComponents bucket (not unprovisionable)', () => {
    const tcs = [zephyrTc('T1', [], { component: 'XYZ' })];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    expect(gaps.missingComponents).toContain('XYZ');
    // It must NOT be lumped into the generic unprovisionable list anymore.
    expect(gaps.unprovisionableLookups.some(u => u.includes('XYZ'))).toBe(false);
  });

  it('deduplicates repeated missing components across test cases', () => {
    const tcs = [
      zephyrTc('T1', [], { component: 'CO' }),
      zephyrTc('T2', [], { component: 'CO' }),
      zephyrTc('T3', [], { component: 'PM' }),
    ];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    expect(gaps.missingComponents.sort()).toEqual(['CO', 'PM']);
  });

  it('does not flag a component that exists in the Spira Components field', () => {
    // metadata() has component "SD".
    const tcs = [zephyrTc('T1', [], { component: 'SD' })];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    expect(gaps.missingComponents).toHaveLength(0);
  });

  it('rowCount counts every observed value (with repeats), not just the distinct ones', () => {
    const tcs = [
      zephyrTc('T1', [{ name: 'Module', value: 'SD' }]),
      zephyrTc('T2', [{ name: 'Module', value: 'SD' }]),
      zephyrTc('T3', [{ name: 'Module', value: 'FI' }]),
      zephyrTc('T4', [{ name: 'Module', value: 'SD, FI' }]), // two values in one cell
    ];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    const mod = gaps.newProperties.find(p => p.name === 'Module')!;
    expect(mod.uniqueValues.sort()).toEqual(['FI', 'SD']);
    expect(mod.rowCount).toBe(5); // 1 + 1 + 1 + 2 observations, not 2 distinct
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
    expect(gaps.missingComponents).toHaveLength(0);
    expect(gaps.unprovisionableLookups).toHaveLength(0);
  });
});

// --- splitMultiValue ---

describe('splitMultiValue', () => {
  it('splits a comma-separated string and trims each part', () => {
    expect(splitMultiValue('DE, HU, CH')).toEqual(['DE', 'HU', 'CH']);
  });

  it('returns a single-element array for a value with no commas', () => {
    expect(splitMultiValue('DE')).toEqual(['DE']);
  });

  it('drops empty entries from trailing/double commas', () => {
    expect(splitMultiValue('DE, , HU,')).toEqual(['DE', 'HU']);
  });

  it('returns an empty array for null and for an empty/whitespace string', () => {
    expect(splitMultiValue(null)).toEqual([]);
    expect(splitMultiValue('   ')).toEqual([]);
  });

  it('stringifies array and scalar inputs', () => {
    expect(splitMultiValue([1, 2, 3])).toEqual(['1', '2', '3']);
    expect(splitMultiValue(42)).toEqual(['42']);
  });
});

// --- resolveZephyrMetadata: multi-value list resolution ---

/** Metadata with a multi-select (type 7) "Country Code" backed by a country list. */
function multiListMetadata(): TemplateMetadata {
  return metadata({
    customProperties: [
      {
        customPropertyId: 2, propertyNumber: 5, name: 'Country Code',
        artifactTypeName: 'TestCase', customPropertyTypeId: 7, customPropertyTypeName: 'MultiList',
        customListId: 20, isRequired: false,
      },
    ],
    customLists: new Map([[20, [
      { customPropertyValueId: 101, name: 'DE', active: true },
      { customPropertyValueId: 102, name: 'HU', active: true },
      { customPropertyValueId: 103, name: 'CH', active: true },
    ]]]),
  });
}

/** Metadata with a single-select (type 6) "Country Code". */
function singleListMetadata(): TemplateMetadata {
  return metadata({
    customProperties: [
      {
        customPropertyId: 3, propertyNumber: 5, name: 'Country Code',
        artifactTypeName: 'TestCase', customPropertyTypeId: 6, customPropertyTypeName: 'List',
        customListId: 20, isRequired: false,
      },
    ],
    customLists: new Map([[20, [
      { customPropertyValueId: 101, name: 'DE', active: true },
      { customPropertyValueId: 102, name: 'HU', active: true },
      { customPropertyValueId: 103, name: 'CH', active: true },
    ]]]),
  });
}

describe('resolveZephyrMetadata — multi-value custom properties', () => {
  it('resolves a comma-separated value to an ID array for a multi-select list', () => {
    const tcs = [zephyrTc('T1', [{ name: 'Country Code', value: 'DE, HU, CH' }])];
    const warnings = resolveZephyrMetadata(tcs, multiListMetadata());

    expect(warnings).toHaveLength(0);
    expect(tcs[0].customProperties).toHaveLength(1);
    expect(tcs[0].customProperties[0]).toEqual({ propertyNumber: 5, value: [101, 102, 103] });
  });

  it('resolves a single value to a one-element array for a multi-select list', () => {
    const tcs = [zephyrTc('T1', [{ name: 'Country Code', value: 'HU' }])];
    resolveZephyrMetadata(tcs, multiListMetadata());
    expect(tcs[0].customProperties[0]).toEqual({ propertyNumber: 5, value: [102] });
  });

  it('warns about values not in the list but keeps the ones that resolve', () => {
    const tcs = [zephyrTc('T1', [{ name: 'Country Code', value: 'DE, ZZ, CH' }])];
    const warnings = resolveZephyrMetadata(tcs, multiListMetadata());

    expect(tcs[0].customProperties[0]).toEqual({ propertyNumber: 5, value: [101, 103] });
    expect(warnings.some(w => w.includes('"ZZ" not in list'))).toBe(true);
  });

  it('for a single-select list with multiple values, keeps the first and warns', () => {
    const tcs = [zephyrTc('T1', [{ name: 'Country Code', value: 'DE, HU, CH' }])];
    const warnings = resolveZephyrMetadata(tcs, singleListMetadata());

    expect(tcs[0].customProperties[0]).toEqual({ propertyNumber: 5, value: 101 });
    expect(warnings.some(w => w.includes('single-select'))).toBe(true);
  });

  it('falls back to the raw text when nothing resolves', () => {
    const tcs = [zephyrTc('T1', [{ name: 'Country Code', value: 'XX, YY' }])];
    resolveZephyrMetadata(tcs, multiListMetadata());
    expect(tcs[0].customProperties[0]).toEqual({ propertyNumber: 5, value: 'XX, YY' });
  });
});

// --- strict list-value matching ---

describe('listValueKey', () => {
  it('ignores case and whitespace, including stray spaces around a slash', () => {
    expect(listValueKey('ME21N')).toBe(listValueKey('me21n'));
    expect(listValueKey('FB03/ VL03N')).toBe(listValueKey('FB03/VL03N'));
    expect(listValueKey('  FB03 /  VL03N ')).toBe(listValueKey('FB03/VL03N'));
  });

  it('keeps genuinely different values different', () => {
    expect(listValueKey('VL02')).not.toBe(listValueKey('VL02N'));
    expect(listValueKey('FB03')).not.toBe(listValueKey('FB03/MIGO'));
  });
});

describe('matchListValue', () => {
  const entries = [
    { name: 'VL02', active: true },
    { name: '2 - High', active: true },
    { name: 'ME21N', active: true },
    { name: 'GONE', active: false },
  ];
  const find = (v: string) => matchListValue(v, entries, e => e.name, e => e.active)?.name;

  it('matches case- and whitespace-insensitively', () => {
    expect(find('me21n')).toBe('ME21N');
  });

  it('does NOT map a longer code onto a shorter one (VL02N is not VL02)', () => {
    expect(find('VL02N')).toBeUndefined();
    expect(find('VL02n')).toBeUndefined();
    expect(find('VL02n / background')).toBeUndefined();
  });

  it('still honours a numeric ordering prefix ("High" ↔ "2 - High")', () => {
    expect(find('High')).toBe('2 - High');
  });

  it('skips inactive entries', () => {
    expect(find('GONE')).toBeUndefined();
  });
});

describe('analyzeZephyrGaps — duplicate detection', () => {
  it('flags a code the source spells two ways, and merges them into ONE missing value', () => {
    const tcs = [
      zephyrTc('T1', [{ name: 'Transaction Code', value: 'ME21N' }]),
      zephyrTc('T2', [{ name: 'Transaction Code', value: 'ME21n' }]),
    ];
    const gaps = analyzeZephyrGaps(tcs, metadata());

    expect(gaps.missingListValues).toHaveLength(1);
    expect(gaps.missingListValues[0].missingValues).toEqual(['ME21N']); // first spelling wins
    expect(gaps.duplicates).toContainEqual({
      property: 'Transaction Code', where: 'source', values: ['ME21N', 'ME21n'],
    });
  });

  it('treats a stray space around a slash as the same value', () => {
    const tcs = [
      zephyrTc('T1', [{ name: 'Transaction Code', value: 'FB03/ VL03N' }]),
      zephyrTc('T2', [{ name: 'Transaction Code', value: 'FB03/VL03N' }]),
    ];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    expect(gaps.missingListValues[0].missingValues).toHaveLength(1);
    expect(gaps.duplicates.filter(d => d.where === 'source')).toHaveLength(1);
  });

  it('flags a longer code as MISSING rather than absorbing it into an existing shorter one', () => {
    // List has VA01; "VA01N" is a different code and must be reported missing.
    const tcs = [zephyrTc('T1', [{ name: 'Transaction Code', value: 'VA01N' }])];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    expect(gaps.missingListValues[0].missingValues).toEqual(['VA01N']);
  });

  it('detects near-duplicates ALREADY in the Spira list, without changing them', () => {
    const md = metadata({
      customLists: new Map([[10, [
        { customPropertyValueId: 1, name: 'ME21N', active: true },
        { customPropertyValueId: 2, name: 'ME21n', active: true },
        { customPropertyValueId: 3, name: 'VA01', active: true },
      ]]]),
    });
    const tcs = [zephyrTc('T1', [{ name: 'Transaction Code', value: 'VA01' }])];
    const gaps = analyzeZephyrGaps(tcs, md);
    expect(gaps.duplicates).toContainEqual({
      property: 'Transaction Code', where: 'template', values: ['ME21N', 'ME21n'],
    });
    expect(gaps.missingListValues).toHaveLength(0);
  });

  it('reports nothing when values are spelled consistently', () => {
    const tcs = [
      zephyrTc('T1', [{ name: 'Transaction Code', value: 'VA01' }]),
      zephyrTc('T2', [{ name: 'Transaction Code', value: 'VA01' }]),
    ];
    expect(analyzeZephyrGaps(tcs, metadata()).duplicates).toEqual([]);
  });

  it('merges spelling variants for a brand-new field too', () => {
    const tcs = [
      zephyrTc('T1', [{ name: 'Module', value: 'SD' }]),
      zephyrTc('T2', [{ name: 'Module', value: 'sd' }]),
      zephyrTc('T3', [{ name: 'Module', value: 'FI' }]),
    ];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    const mod = gaps.newProperties.find(p => p.name === 'Module')!;
    expect(mod.uniqueValues.sort()).toEqual(['FI', 'SD']);
    expect(gaps.duplicates).toContainEqual({ property: 'Module', where: 'source', values: ['SD', 'sd'] });
  });
});

describe('resolveZephyrMetadata — strict list values', () => {
  it('resolves a spacing/case variant to the existing entry, but not a longer code', () => {
    const md = metadata({
      customLists: new Map([[10, [
        { customPropertyValueId: 7, name: 'FB03/VL03N', active: true },
        { customPropertyValueId: 8, name: 'VA01', active: true },
      ]]]),
    });
    const tcs = [
      zephyrTc('T1', [{ name: 'Transaction Code', value: 'FB03/ VL03N' }]),
      zephyrTc('T2', [{ name: 'Transaction Code', value: 'VA01N' }]),
    ];
    const warnings = resolveZephyrMetadata(tcs, md);

    expect(tcs[0].customProperties[0].value).toBe(7);          // spacing variant → existing entry
    expect(warnings.some(w => w.includes('"VA01N" not in list'))).toBe(true); // not absorbed into VA01
  });
});

describe('analyzeZephyrGaps — multiValued flag', () => {
  it('flags an existing field multiValued when any row has a comma-separated value, keyed by the Spira field name', () => {
    // Source says "Country Code"; the Spira field is "Country" — flag must land on "Country".
    const md = metadata({
      customProperties: [{
        customPropertyId: 3, propertyNumber: 5, name: 'Country',
        artifactTypeName: 'TestCase', customPropertyTypeId: 6, customPropertyTypeName: 'List',
        customListId: 20, isRequired: false,
      }],
      customLists: new Map([[20, [{ customPropertyValueId: 101, name: 'DE', active: true }]]]),
    });
    const tcs = [
      zephyrTc('T1', [{ name: 'Country Code', value: 'DE' }]),
      zephyrTc('T2', [{ name: 'Country Code', value: 'HU, CH' }]),
    ];
    const gaps = analyzeZephyrGaps(tcs, md);
    const country = gaps.missingListValues.find(m => m.propertyName === 'Country')!;
    expect(country.missingValues.sort()).toEqual(['CH', 'HU']);
    expect(country.multiValued).toBe(true);
  });

  it('leaves multiValued false when every row holds a single value', () => {
    const tcs = [
      zephyrTc('T1', [{ name: 'Transaction Code', value: 'VL10B' }]),
      zephyrTc('T2', [{ name: 'Transaction Code', value: 'FB03/MIGO' }]), // slash is NOT a separator
    ];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    const tx = gaps.missingListValues.find(m => m.propertyName === 'Transaction Code')!;
    expect(tx.multiValued).toBe(false);
  });

  it('keeps a field multiValued when the template field is already multi-select (type 7)', () => {
    const md = metadata({
      customProperties: [{
        customPropertyId: 4, propertyNumber: 1, name: 'Transaction Code',
        artifactTypeName: 'TestCase', customPropertyTypeId: 7, customPropertyTypeName: 'MultiList',
        customListId: 10, isRequired: false,
      }],
    });
    // Single-valued data, but the template field is already multi-select.
    const tcs = [zephyrTc('T1', [{ name: 'Transaction Code', value: 'VL10B' }])];
    const gaps = analyzeZephyrGaps(tcs, md);
    expect(gaps.missingListValues[0].multiValued).toBe(true);
  });

  it('flags a brand-new property multiValued from comma-separated data', () => {
    const tcs = [zephyrTc('T1', [{ name: 'Region', value: 'EMEA, APAC' }])];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    expect(gaps.newProperties.find(p => p.name === 'Region')!.multiValued).toBe(true);
  });
});

describe('analyzeZephyrGaps — multi-value splitting', () => {
  it('reports each missing list value separately, not the whole comma string', () => {
    const tcs = [zephyrTc('T1', [{ name: 'Country Code', value: 'DE, ZZ, CH' }])];
    const gaps = analyzeZephyrGaps(tcs, multiListMetadata());

    expect(gaps.missingListValues).toHaveLength(1);
    expect(gaps.missingListValues[0].missingValues).toEqual(['ZZ']);
  });

  it('splits values for a brand-new multi-value property', () => {
    // No "Country Code" in this template → treated as a new property.
    const tcs = [zephyrTc('T1', [{ name: 'Country Code', value: 'DE, HU, CH' }])];
    const gaps = analyzeZephyrGaps(tcs, metadata());
    const prop = gaps.newProperties.find(p => p.name === 'Country Code')!;
    expect(prop.uniqueValues.sort()).toEqual(['CH', 'DE', 'HU']);
  });
});
