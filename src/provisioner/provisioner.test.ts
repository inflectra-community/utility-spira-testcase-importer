/**
 * Unit tests for the SpiraProvisioner module.
 *
 * Focus: the list-vs-text type inference (inferFieldType / variability scoring),
 * which is known to misclassify on small samples, plus the config generation
 * and missing-value detection. These are pure functions and the highest-risk
 * untested logic in the codebase.
 */

import { describe, it, expect } from 'vitest';
import {
  inferFieldType,
  generateProvisionerConfig,
  extractColumnInfo,
  findMissingListValues,
  type UnmatchedColumnInfo,
} from './index.js';
import type { CustomPropertyDefinition, CustomListValue } from '../types/spira.js';

function col(columnName: string, uniqueValues: string[], rowCount?: number): UnmatchedColumnInfo {
  return { columnName, uniqueValues, rowCount: rowCount ?? uniqueValues.length };
}

describe('inferFieldType', () => {
  it('classifies an empty column as text', () => {
    const r = inferFieldType(col('Empty', []), 20);
    expect(r.type).toBe('text');
  });

  it('classifies a small, repeated value set as a list', () => {
    // 3 distinct values across 30 rows → low cardinality → list
    const r = inferFieldType(col('Status', ['Open', 'Closed', 'Blocked'], 30), 20);
    expect(r.type).toBe('list');
    expect(r.values).toEqual(['Blocked', 'Closed', 'Open']); // sorted
  });

  it('classifies high-cardinality free text as text', () => {
    // 20 unique values across 20 rows → cardinality 1.0 → text
    const unique = Array.from({ length: 20 }, (_, i) => `Expected result number ${i} is a long sentence`);
    const r = inferFieldType(col('Expected Result', unique, 20), 20);
    expect(r.type).toBe('text');
    expect(r.values).toBeUndefined();
  });

  it('detects boolean columns', () => {
    const r = inferFieldType(col('Automated', ['Yes', 'No'], 40), 20);
    expect(r.type).toBe('boolean');
  });

  it('detects integer columns', () => {
    const r = inferFieldType(col('Count', ['1', '2', '3', '10'], 40), 20);
    expect(r.type).toBe('integer');
  });

  it('detects date columns', () => {
    const r = inferFieldType(col('Date', ['2025-01-01', '2025-06-30', '2024-12-25'], 30), 20);
    expect(r.type).toBe('date');
  });

  it('falls back to text when distinct values exceed the list threshold', () => {
    // Low variability but 25 distinct short codes, threshold 20 → text
    const unique = Array.from({ length: 25 }, (_, i) => `C${i}`);
    const r = inferFieldType(col('Code', unique, 200), 20);
    expect(r.type).toBe('text');
  });

  it('returns a variability score between 0 and 1', () => {
    const r = inferFieldType(col('X', ['a', 'b', 'c'], 10), 20);
    expect(r.variabilityScore).toBeGreaterThanOrEqual(0);
    expect(r.variabilityScore).toBeLessThanOrEqual(1);
  });

  it('known limitation: a genuine dropdown with few rows can look like text', () => {
    // 3 distinct values but only 3 rows → cardinality 1.0 → inferred text,
    // even though a human would call this a list. Documents current behaviour.
    const r = inferFieldType(col('Country', ['DE', 'FR', 'US'], 3), 20);
    expect(r.type).toBe('text');
  });
});

describe('generateProvisionerConfig', () => {
  it('produces the provisioner schema shape with program + product', () => {
    const config = generateProvisionerConfig({
      programName: 'Prog',
      productName: 'Prod',
      newColumns: [col('Region', ['EMEA', 'APAC'], 20)],
      missingValues: [],
    }) as any;

    expect(config.$schema).toContain('spira-structure.schema.json');
    expect(config.program.name).toBe('Prog');
    expect(config.program.products).toHaveLength(1);
    expect(config.program.products[0].name).toBe('Prod');
    const fields = config.program.products[0].customFields.testCases;
    expect(fields.find((f: any) => f.name === 'Region')).toBeTruthy();
  });

  it('merges existing + missing values for an existing list property', () => {
    const config = generateProvisionerConfig({
      programName: 'Prog',
      productName: 'Prod',
      newColumns: [],
      missingValues: [
        { propertyName: 'Transaction Code', existingValues: ['VA01'], missingValues: ['VL10B'] },
      ],
    }) as any;

    const field = config.program.products[0].customFields.testCases.find((f: any) => f.name === 'Transaction Code');
    expect(field.type).toBe('list');
    expect(field.values).toEqual(['VA01', 'VL10B']); // existing + missing, sorted, deduped
  });
});

describe('extractColumnInfo', () => {
  it('collects unique non-empty values and row counts per column', () => {
    const rows = [
      { Priority: 'High', Notes: 'a' },
      { Priority: 'Low', Notes: '' },
      { Priority: 'High', Notes: null },
      { Priority: '', Notes: 'b' },
    ];
    const info = extractColumnInfo(rows, ['Priority', 'Notes']);
    const priority = info.find(i => i.columnName === 'Priority')!;
    expect(priority.uniqueValues.sort()).toEqual(['High', 'Low']);
    expect(priority.rowCount).toBe(3); // 3 non-empty cells
  });
});

describe('findMissingListValues', () => {
  const customProperties: CustomPropertyDefinition[] = [
    {
      customPropertyId: 1,
      propertyNumber: 1,
      name: 'Transaction Code',
      artifactTypeName: 'TestCase',
      customPropertyTypeId: 6,
      customPropertyTypeName: 'List',
      customListId: 10,
      isRequired: false,
    },
  ];
  const customLists = new Map<number, CustomListValue[]>([
    [10, [
      { customPropertyValueId: 1, name: 'VA01', active: true },
      { customPropertyValueId: 2, name: 'VL01', active: true },
    ]],
  ]);

  it('reports source values not present in the Spira list', () => {
    const rows = [
      { Transaction: 'VA01' },
      { Transaction: 'ZZZ99' },
      { Transaction: 'VL01' },
    ];
    const result = findMissingListValues(
      rows,
      [{ sourceColumn: 'Transaction', targetField: 'Transaction Code' }],
      customProperties,
      customLists,
    );
    expect(result).toHaveLength(1);
    expect(result[0].propertyName).toBe('Transaction Code');
    expect(result[0].missingValues).toEqual(['ZZZ99']);
  });

  it('reports nothing when every value is already in the list', () => {
    const rows = [{ Transaction: 'VA01' }, { Transaction: 'VL01' }];
    const result = findMissingListValues(
      rows,
      [{ sourceColumn: 'Transaction', targetField: 'Transaction Code' }],
      customProperties,
      customLists,
    );
    expect(result).toHaveLength(0);
  });

  it('is case-insensitive when comparing against existing list values', () => {
    const rows = [{ Transaction: 'va01' }];
    const result = findMissingListValues(
      rows,
      [{ sourceColumn: 'Transaction', targetField: 'Transaction Code' }],
      customProperties,
      customLists,
    );
    expect(result).toHaveLength(0);
  });
});
