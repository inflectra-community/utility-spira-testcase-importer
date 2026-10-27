import { describe, it, expect } from 'vitest';
import { matchColumns } from './column-matcher.js';
import type { ColumnMatcherConfig } from './types.js';
import type { FieldDefinition } from '../types/strategy.js';

const FIELDS: FieldDefinition[] = [
  { name: 'Name', label: 'Name', type: 'string', required: true, description: '' },
  { name: 'Description', label: 'Description', type: 'string', required: false, description: '' },
  { name: 'TestCasePriorityId', label: 'Priority', type: 'integer', required: false, description: '' },
  { name: 'TestCaseStatusId', label: 'Status', type: 'integer', required: false, description: '' },
  { name: 'ComponentIds', label: 'Components', type: 'integer[]', required: false, description: '' },
];

function cfg(customPropertyNames: string[] = []): ColumnMatcherConfig {
  return { fieldDefinitions: FIELDS, customPropertyNames };
}

function matchFor(result: ReturnType<typeof matchColumns>, sourceColumn: string) {
  return result.matches.find(m => m.sourceColumn === sourceColumn);
}

describe('matchColumns', () => {
  it('matches an exact field name with confidence 1.0', () => {
    const r = matchColumns(['Name'], cfg());
    expect(matchFor(r, 'Name')).toMatchObject({ targetField: 'Name', confidence: 1.0, matchReason: 'exact' });
  });

  it('matches a known alias (e.g. Priority → TestCasePriorityId)', () => {
    const r = matchColumns(['Priority'], cfg());
    expect(matchFor(r, 'Priority')).toMatchObject({ targetField: 'TestCasePriorityId', matchReason: 'alias' });
  });

  it('auto-ignores attachment-like columns', () => {
    const r = matchColumns(['Attachments', 'Test Step Attachment'], cfg());
    expect(matchFor(r, 'Attachments')?.targetField).toBe('__Ignore__');
    expect(matchFor(r, 'Test Step Attachment')?.targetField).toBe('__Ignore__');
  });

  it('maps folder-like columns to the folder sentinel', () => {
    const r = matchColumns(['Folder Path'], cfg());
    expect(matchFor(r, 'Folder Path')?.targetField).toBe('__FolderPath__');
  });

  it('matches a custom property by exact name', () => {
    const r = matchColumns(['Transaction Code'], cfg(['Transaction Code']));
    expect(matchFor(r, 'Transaction Code')).toMatchObject({ targetField: 'Transaction Code', matchReason: 'custom-property' });
  });

  it('matches "Transaction" to a "Transaction Code" custom property by contains', () => {
    const r = matchColumns(['Transaction'], cfg(['Transaction Code']));
    const m = matchFor(r, 'Transaction');
    expect(m?.targetField).toBe('Transaction Code');
  });

  it('reports a truly unknown column as unmatched', () => {
    const r = matchColumns(['Blorptastic'], cfg());
    expect(r.unmatched).toContain('Blorptastic');
  });

  it('strips a "Test Case " prefix and re-matches', () => {
    const r = matchColumns(['Test Case Name'], cfg());
    // "Test Case Name" → alias 'test case name' maps to Name directly
    expect(matchFor(r, 'Test Case Name')?.targetField).toBe('Name');
  });

  it('skips empty/blank headers without error', () => {
    const r = matchColumns(['', '   ', 'Name'], cfg());
    expect(matchFor(r, 'Name')).toBeTruthy();
    expect(r.matches).toHaveLength(1);
  });
});
