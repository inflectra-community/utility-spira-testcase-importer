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
  resolveNewFieldType,
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

  it('exports an existing field as multilist when it is flagged multiValued', () => {
    const config = generateProvisionerConfig({
      programName: 'Prog',
      productName: 'Prod',
      newColumns: [],
      missingValues: [
        { propertyName: 'Country', existingValues: ['DE'], missingValues: ['HU', 'CH'], multiValued: true },
      ],
    }) as any;

    const field = config.program.products[0].customFields.testCases.find((f: any) => f.name === 'Country');
    expect(field.type).toBe('multilist');
    expect(field.values).toEqual(['CH', 'DE', 'HU']);
  });

  it('keeps an existing field as a single-select list when multiValued is false or absent', () => {
    const config = generateProvisionerConfig({
      programName: 'Prog',
      productName: 'Prod',
      newColumns: [],
      missingValues: [
        { propertyName: 'A', existingValues: [], missingValues: ['x'], multiValued: false },
        { propertyName: 'B', existingValues: [], missingValues: ['y'] },
      ],
    }) as any;

    const fields = config.program.products[0].customFields.testCases;
    expect(fields.find((f: any) => f.name === 'A').type).toBe('list');
    expect(fields.find((f: any) => f.name === 'B').type).toBe('list');
  });

  it('exports a new list-like column as multilist when multiValued', () => {
    const config = generateProvisionerConfig({
      programName: 'Prog',
      productName: 'Prod',
      newColumns: [
        // Few distinct, repeated values → inferred as a list.
        { columnName: 'Region', uniqueValues: ['EMEA', 'APAC'], rowCount: 20, multiValued: true },
      ],
      missingValues: [],
    }) as any;

    const field = config.program.products[0].customFields.testCases.find((f: any) => f.name === 'Region');
    expect(field.type).toBe('multilist');
    expect(field.values).toEqual(['APAC', 'EMEA']);
  });

  it('never makes a multi-valued scalar column a multilist or an integer — it falls back to text', () => {
    const config = generateProvisionerConfig({
      programName: 'Prog',
      productName: 'Prod',
      newColumns: [
        { columnName: 'Qty', uniqueValues: ['1', '2'], rowCount: 10, multiValued: true },
        { columnName: 'Single', uniqueValues: ['1', '2'], rowCount: 10 },
      ],
      missingValues: [],
    }) as any;

    const fields = config.program.products[0].customFields.testCases;
    // Several values per cell can't fit an integer field…
    expect(fields.find((f: any) => f.name === 'Qty').type).toBe('text');
    // …but a genuinely single-valued numeric column is still an integer.
    expect(fields.find((f: any) => f.name === 'Single').type).toBe('integer');
  });
});

describe('resolveNewFieldType — per-field type switch', () => {
  // 40 distinct, longish, high-variability values: inference calls this free text.
  const codes = Array.from({ length: 40 }, (_, i) => `ZTX${String(i).padStart(3, '0')}/ALT_${i * 7}`);
  const transactionCodes = { columnName: 'Transaction Code', uniqueValues: codes, rowCount: 60 };

  it('auto lets inference decide (high-cardinality codes → text)', () => {
    const r = resolveNewFieldType(transactionCodes, 20);
    expect(r.type).toBe('text');
    expect(r.values).toBeUndefined();
  });

  it('forceType text keeps a list-like column as free text, with no values', () => {
    const r = resolveNewFieldType(
      { columnName: 'Country', uniqueValues: ['DE', 'FR'], rowCount: 30, forceType: 'text' },
      20,
    );
    expect(r.type).toBe('text');
    expect(r.values).toBeUndefined();
  });

  it('forceType list turns free-text-looking data into a single-select list of the distinct values', () => {
    const r = resolveNewFieldType({ ...transactionCodes, forceType: 'list' }, 20);
    expect(r.type).toBe('list');
    expect(r.values).toHaveLength(40);
    expect(r.values).toEqual([...codes].sort());
  });

  it('forceType multilist produces a multi-select list', () => {
    const r = resolveNewFieldType({ ...transactionCodes, forceType: 'multilist' }, 20);
    expect(r.type).toBe('multilist');
    expect(r.values).toHaveLength(40);
  });

  it('auto never makes a multi-valued column an integer (cells like "6021, 6022" would fail)', () => {
    const plant = { columnName: 'Plant Number', uniqueValues: ['6021', '6022', '6030'], rowCount: 30 };
    expect(resolveNewFieldType(plant, 20).type).toBe('integer'); // single-valued: integer is right
    expect(resolveNewFieldType({ ...plant, multiValued: true }, 20).type).toBe('text');
  });

  it('auto picks a select list for a small controlled vocabulary seen many times', () => {
    // 7 distinct values over 61 occurrences, like the Module field.
    const module_ = { columnName: 'Module', uniqueValues: ['SD', 'FI', 'MM', 'WM', 'QM', 'PM', 'CO'], rowCount: 61 };
    const r = resolveNewFieldType(module_, 20);
    expect(r.type).toBe('list');
    expect(r.values).toHaveLength(7);
  });

  it('forceType auto behaves exactly like no override (multiValued still promotes a list)', () => {
    const col = { columnName: 'Region', uniqueValues: ['EMEA', 'APAC'], rowCount: 20, multiValued: true };
    expect(resolveNewFieldType({ ...col, forceType: 'auto' }, 20)).toEqual(resolveNewFieldType(col, 20));
    expect(resolveNewFieldType(col, 20).type).toBe('multilist');
  });
});

describe('generateProvisionerConfig — forceType', () => {
  it('writes the forced type into the structure file', () => {
    const config = generateProvisionerConfig({
      programName: 'Prog',
      productName: 'Prod',
      newColumns: [
        { columnName: 'Transaction Code', uniqueValues: ['VA01', 'VL10B'], rowCount: 10, forceType: 'text' },
        { columnName: 'Country', uniqueValues: ['DE', 'FR'], rowCount: 10, forceType: 'multilist' },
      ],
      missingValues: [],
    }) as any;

    const fields = config.program.products[0].customFields.testCases;
    const tx = fields.find((f: any) => f.name === 'Transaction Code');
    const country = fields.find((f: any) => f.name === 'Country');
    expect(tx.type).toBe('text');
    expect(tx.values).toBeUndefined();
    expect(country.type).toBe('multilist');
    expect(country.values).toEqual(['DE', 'FR']);
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
