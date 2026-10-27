import { describe, it, expect } from 'vitest';
import { resolveValues } from './value-resolver.js';
import type { ValueResolverConfig } from './types.js';

function baseConfig(overrides?: Partial<ValueResolverConfig>): ValueResolverConfig {
  return {
    priorities: [
      { id: 1, name: '1 - Critical' },
      { id: 2, name: '2 - High' },
      { id: 3, name: '3 - Medium' },
      { id: 4, name: '4 - Low' },
    ],
    statuses: [
      { id: 10, name: 'Draft' },
      { id: 11, name: 'Ready for Test' },
    ],
    types: [],
    users: [{ id: 50, fullName: 'Jane Tester', userName: 'jtester' }],
    components: [{ id: 60, name: 'SD' }],
    customLists: new Map(),
    ...overrides,
  };
}

describe('resolveValues', () => {
  it('resolves exact value matches case-insensitively', () => {
    const rows = [{ Priority: '1 - Critical' }, { Priority: '3 - medium' }];
    const result = resolveValues(rows, new Map([['Priority', 'TestCasePriorityId']]), baseConfig());
    const map = result.lookupMaps.get('TestCasePriorityId')!;
    expect(map['1 - Critical']).toBe(1);
    expect(map['3 - medium']).toBe(3);
  });

  it('resolves a bare value to a numeric-prefixed target (High → 2 - High)', () => {
    const rows = [{ Priority: 'High' }];
    const result = resolveValues(rows, new Map([['Priority', 'TestCasePriorityId']]), baseConfig());
    const map = result.lookupMaps.get('TestCasePriorityId')!;
    expect(map['High']).toBe(2);
  });

  it('reports values that cannot be resolved', () => {
    const rows = [{ Priority: 'Showstopper' }];
    const result = resolveValues(rows, new Map([['Priority', 'TestCasePriorityId']]), baseConfig());
    expect(result.unresolvedValues).toContainEqual({ field: 'TestCasePriorityId', sourceValue: 'Showstopper' });
  });

  it('resolves owners by full name', () => {
    const rows = [{ Owner: 'Jane Tester' }];
    const result = resolveValues(rows, new Map([['Owner', 'OwnerId']]), baseConfig());
    expect(result.lookupMaps.get('OwnerId')!['Jane Tester']).toBe(50);
  });

  it('deduplicates repeated source values', () => {
    const rows = [{ Priority: 'High' }, { Priority: 'High' }, { Priority: 'High' }];
    const result = resolveValues(rows, new Map([['Priority', 'TestCasePriorityId']]), baseConfig());
    expect(result.resolutionLog.filter(l => l.sourceValue === 'High')).toHaveLength(1);
  });

  it('skips blank cells', () => {
    const rows = [{ Priority: '' }, { Priority: null }, { Priority: 'High' }];
    const result = resolveValues(rows, new Map([['Priority', 'TestCasePriorityId']]), baseConfig());
    const map = result.lookupMaps.get('TestCasePriorityId')!;
    expect(Object.keys(map)).toEqual(['High']);
  });

  it('resolves custom-property list values when provided', () => {
    const config = baseConfig({
      customPropertyListEntries: new Map([
        ['Environment', [{ id: 201, name: 'Production' }, { id: 202, name: 'Staging' }]],
      ]),
    });
    const rows = [{ Env: 'Production' }];
    const result = resolveValues(rows, new Map([['Env', 'Environment']]), config);
    expect(result.lookupMaps.get('Environment')!['Production']).toBe(201);
  });
});
