/**
 * Custom Property Serializer
 *
 * Converts internal CustomPropertyValue objects to the RemoteCustomProperty format
 * required by the Spira REST API. Maps property types to the correct value field
 * based on the property's CustomPropertyDefinition.
 *
 * Type mapping:
 *   1 (Text)       → StringValue
 *   2 (Integer)    → IntegerValue
 *   3 (Decimal)    → IntegerValue
 *   4 (Boolean)    → BooleanValue
 *   5 (Date)       → DateTimeValue
 *   6 (List)       → IntegerListValue (as single-element array)
 *   7 (MultiList)  → IntegerListValue
 *   8 (User)       → IntegerValue
 */

import type { CustomPropertyDefinition } from '../types/spira.js';
import type { CustomPropertyValue } from '../types/transform.js';
import type { RemoteCustomProperty } from '../types/import.js';

/**
 * Serializes a CustomPropertyValue to the RemoteCustomProperty format
 * expected by the Spira REST API.
 *
 * @param propertyValue - The internal custom property value to serialize
 * @param definition - The custom property definition providing type information
 * @returns A RemoteCustomProperty with exactly one value field populated,
 *          or just PropertyNumber if the value is null
 */
export function serializeCustomProperty(
  propertyValue: CustomPropertyValue,
  definition: CustomPropertyDefinition
): RemoteCustomProperty {
  const result: RemoteCustomProperty = {
    PropertyNumber: propertyValue.propertyNumber,
  };

  // Null values: return object with just PropertyNumber
  if (propertyValue.value === null) {
    return result;
  }

  switch (definition.customPropertyTypeId) {
    // Text (1) → StringValue
    case 1:
      result.StringValue = String(propertyValue.value);
      break;

    // Integer (2) → IntegerValue
    case 2: {
      const numVal = Number(propertyValue.value);
      if (isNaN(numVal)) return result;
      result.IntegerValue = numVal;
      break;
    }

    // Decimal (3) → IntegerValue
    case 3: {
      const numVal = Number(propertyValue.value);
      if (isNaN(numVal)) return result;
      result.IntegerValue = numVal;
      break;
    }

    // Boolean (4) → BooleanValue
    case 4:
      result.BooleanValue = Boolean(propertyValue.value);
      break;

    // Date (5) → DateTimeValue
    case 5:
      result.DateTimeValue = String(propertyValue.value);
      break;

    // List (6) → IntegerListValue as single-element array
    case 6: {
      const numVal = Number(propertyValue.value);
      if (isNaN(numVal)) {
        // Value couldn't be resolved to an ID — skip this property
        return result; // Returns just PropertyNumber with no value field
      }
      result.IntegerListValue = [numVal];
      break;
    }

    // MultiList (7) → IntegerListValue
    case 7: {
      if (Array.isArray(propertyValue.value)) {
        const nums = propertyValue.value.map(Number).filter(n => !isNaN(n));
        if (nums.length === 0) return result;
        result.IntegerListValue = nums;
      } else {
        const numVal = Number(propertyValue.value);
        if (isNaN(numVal)) return result;
        result.IntegerListValue = [numVal];
      }
      break;
    }

    // User (8) → IntegerValue
    case 8:
      result.IntegerValue = Number(propertyValue.value);
      break;

    default:
      // Unknown type: fall back to StringValue
      result.StringValue = String(propertyValue.value);
      break;
  }

  return result;
}
