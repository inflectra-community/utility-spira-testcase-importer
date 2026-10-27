/**
 * Unit tests for the custom property serializer.
 *
 * The critical invariant: each Spira custom property type must serialize to
 * exactly ONE value field, and single-select List (type 6) must use
 * IntegerValue — NOT IntegerListValue (a gotcha that previously caused a
 * foreign-key error on import).
 */

import { describe, it, expect } from 'vitest';
import { serializeCustomProperty } from './custom-property-serializer.js';
import type { CustomPropertyDefinition } from '../types/spira.js';
import type { CustomPropertyValue } from '../types/transform.js';

function def(typeId: number, propertyNumber = 1): CustomPropertyDefinition {
  return {
    customPropertyId: 1,
    propertyNumber,
    name: `Prop${propertyNumber}`,
    artifactTypeName: 'TestCase',
    customPropertyTypeId: typeId,
    customPropertyTypeName: 'X',
    isRequired: false,
  };
}
function val(value: CustomPropertyValue['value'], propertyNumber = 1): CustomPropertyValue {
  return { propertyNumber, value };
}

/** Returns the names of the populated value fields (excluding PropertyNumber). */
function valueFields(obj: object): string[] {
  return Object.keys(obj).filter(k => k !== 'PropertyNumber');
}

describe('serializeCustomProperty', () => {
  it('always carries the PropertyNumber', () => {
    const r = serializeCustomProperty(val('x', 7), def(1, 7));
    expect(r.PropertyNumber).toBe(7);
  });

  it('null value → only PropertyNumber, no value field', () => {
    const r = serializeCustomProperty(val(null), def(1));
    expect(valueFields(r)).toHaveLength(0);
  });

  it('Text (1) → StringValue', () => {
    const r = serializeCustomProperty(val('hello'), def(1));
    expect(r.StringValue).toBe('hello');
    expect(valueFields(r)).toEqual(['StringValue']);
  });

  it('Integer (2) → IntegerValue', () => {
    const r = serializeCustomProperty(val('42'), def(2));
    expect(r.IntegerValue).toBe(42);
    expect(valueFields(r)).toEqual(['IntegerValue']);
  });

  it('Decimal (3) → IntegerValue', () => {
    const r = serializeCustomProperty(val(3.5), def(3));
    expect(r.IntegerValue).toBe(3.5);
  });

  it('Boolean (4) → BooleanValue', () => {
    const r = serializeCustomProperty(val(true), def(4));
    expect(r.BooleanValue).toBe(true);
    expect(valueFields(r)).toEqual(['BooleanValue']);
  });

  it('Date (5) → DateTimeValue', () => {
    const r = serializeCustomProperty(val('2025-01-01T00:00:00Z'), def(5));
    expect(r.DateTimeValue).toBe('2025-01-01T00:00:00Z');
  });

  it('List (6) → IntegerValue (NOT IntegerListValue) — the single-select gotcha', () => {
    const r = serializeCustomProperty(val(55), def(6));
    expect(r.IntegerValue).toBe(55);
    expect(r.IntegerListValue).toBeUndefined();
    expect(valueFields(r)).toEqual(['IntegerValue']);
  });

  it('List (6) with an unresolvable (non-numeric) value → no value field', () => {
    const r = serializeCustomProperty(val('Not An Id'), def(6));
    expect(valueFields(r)).toHaveLength(0);
  });

  it('MultiList (7) with a single value → IntegerListValue array', () => {
    const r = serializeCustomProperty(val(9), def(7));
    expect(r.IntegerListValue).toEqual([9]);
  });

  it('MultiList (7) with an array → IntegerListValue, non-numeric entries dropped', () => {
    const r = serializeCustomProperty(val([1, 2, 'x'] as unknown as CustomPropertyValue['value']), def(7));
    expect(r.IntegerListValue).toEqual([1, 2]);
  });

  it('User (8) → IntegerValue', () => {
    const r = serializeCustomProperty(val(3), def(8));
    expect(r.IntegerValue).toBe(3);
  });

  it('every non-null type produces at most one value field', () => {
    for (const typeId of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = serializeCustomProperty(val(typeId === 4 ? true : 1), def(typeId));
      expect(valueFields(r).length).toBeLessThanOrEqual(1);
    }
  });
});
