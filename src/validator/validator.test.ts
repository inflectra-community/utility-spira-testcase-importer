import { describe, it, expect } from 'vitest';
import { createValidationEngine } from './index.js';
import type { TransformedTestCase } from '../types/transform.js';
import type { TemplateMetadata } from '../types/spira.js';

function createMinimalMetadata(overrides?: Partial<TemplateMetadata>): TemplateMetadata {
  return {
    projectId: 1,
    templateId: 1,
    priorities: [
      { priorityId: 1, name: 'High', active: true, score: 4 },
      { priorityId: 2, name: 'Medium', active: true, score: 3 },
      { priorityId: 3, name: 'Low', active: false, score: 1 },
    ],
    statuses: [
      { testCaseStatusId: 1, name: 'Draft', active: true },
      { testCaseStatusId: 2, name: 'Ready', active: true },
    ],
    types: [
      { testCaseTypeId: 1, name: 'Functional', active: true, isDefault: true },
      { testCaseTypeId: 2, name: 'Performance', active: true, isDefault: false },
    ],
    customProperties: [
      {
        customPropertyId: 100,
        propertyNumber: 1,
        name: 'Environment',
        artifactTypeName: 'TestCase',
        customPropertyTypeId: 6, // List
        customPropertyTypeName: 'List',
        customListId: 10,
        isRequired: false,
      },
      {
        customPropertyId: 101,
        propertyNumber: 2,
        name: 'Notes',
        artifactTypeName: 'TestCase',
        customPropertyTypeId: 1, // Text
        customPropertyTypeName: 'Text',
        isRequired: false,
      },
      {
        customPropertyId: 102,
        propertyNumber: 3,
        name: 'Severity',
        artifactTypeName: 'TestCase',
        customPropertyTypeId: 2, // Integer
        customPropertyTypeName: 'Integer',
        isRequired: false,
      },
      {
        customPropertyId: 103,
        propertyNumber: 4,
        name: 'Weight',
        artifactTypeName: 'TestCase',
        customPropertyTypeId: 3, // Decimal
        customPropertyTypeName: 'Decimal',
        isRequired: false,
      },
      {
        customPropertyId: 104,
        propertyNumber: 5,
        name: 'Automated',
        artifactTypeName: 'TestCase',
        customPropertyTypeId: 4, // Boolean
        customPropertyTypeName: 'Boolean',
        isRequired: false,
      },
      {
        customPropertyId: 105,
        propertyNumber: 6,
        name: 'Due Date',
        artifactTypeName: 'TestCase',
        customPropertyTypeId: 5, // Date
        customPropertyTypeName: 'Date',
        isRequired: false,
      },
      {
        customPropertyId: 106,
        propertyNumber: 7,
        name: 'Tags',
        artifactTypeName: 'TestCase',
        customPropertyTypeId: 7, // MultiList
        customPropertyTypeName: 'MultiList',
        customListId: 20,
        isRequired: false,
      },
      {
        customPropertyId: 107,
        propertyNumber: 8,
        name: 'Assigned Tester',
        artifactTypeName: 'TestCase',
        customPropertyTypeId: 8, // User
        customPropertyTypeName: 'User',
        isRequired: false,
      },
    ],
    customLists: new Map([
      [10, [
        { customPropertyValueId: 101, name: 'Production', active: true },
        { customPropertyValueId: 102, name: 'Staging', active: true },
        { customPropertyValueId: 103, name: 'Dev', active: false },
      ]],
      [20, [
        { customPropertyValueId: 201, name: 'Smoke', active: true },
        { customPropertyValueId: 202, name: 'Regression', active: true },
        { customPropertyValueId: 203, name: 'Archived', active: false },
      ]],
    ]),
    users: [
      { userId: 1, fullName: 'Alice Smith', userName: 'alice', active: true },
      { userId: 2, fullName: 'Bob Jones', userName: 'bob', active: true },
      { userId: 3, fullName: 'Charlie Brown', userName: 'charlie', active: false },
    ],
    components: [
      { componentId: 1, name: 'Backend', active: true },
    ],
    existingFolders: [],
    ...overrides,
  };
}

function createValidTestCase(overrides?: Partial<TransformedTestCase>): TransformedTestCase {
  return {
    sourceRowIndex: 0,
    name: 'Login Test',
    testCaseStatusId: 1,
    testCaseTypeId: 1,
    customProperties: [],
    testSteps: [],
    ...overrides,
  };
}

describe('ValidationEngine', () => {
  const engine = createValidationEngine();
  const metadata = createMinimalMetadata();

  describe('Required field validation', () => {
    it('should pass when Name is non-empty', () => {
      const result = engine.validate([createValidTestCase()], metadata);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error when Name is empty string', () => {
      const result = engine.validate(
        [createValidTestCase({ name: '' })],
        metadata
      );
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('Name');
      expect(result.errors[0].severity).toBe('error');
    });

    it('should error when Name is whitespace only', () => {
      const result = engine.validate(
        [createValidTestCase({ name: '   ' })],
        metadata
      );
      expect(result.isValid).toBe(false);
      expect(result.errors[0].field).toBe('Name');
    });
  });

  describe('Status validation', () => {
    it('should pass for a valid status ID', () => {
      const result = engine.validate(
        [createValidTestCase({ testCaseStatusId: 1 })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should error for an invalid status ID', () => {
      const result = engine.validate(
        [createValidTestCase({ testCaseStatusId: 999 })],
        metadata
      );
      expect(result.isValid).toBe(false);
      expect(result.errors[0].field).toBe('TestCaseStatusId');
    });

    it('should not error when status is not set', () => {
      const result = engine.validate(
        [createValidTestCase({ testCaseStatusId: undefined })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });
  });

  describe('Type validation', () => {
    it('should pass for a valid type ID', () => {
      const result = engine.validate(
        [createValidTestCase({ testCaseTypeId: 2 })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should error for an invalid type ID', () => {
      const result = engine.validate(
        [createValidTestCase({ testCaseTypeId: 999 })],
        metadata
      );
      expect(result.isValid).toBe(false);
      expect(result.errors[0].field).toBe('TestCaseTypeId');
    });
  });

  describe('Priority validation', () => {
    it('should pass for an active priority ID', () => {
      const result = engine.validate(
        [createValidTestCase({ testCasePriorityId: 1 })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should error for an inactive priority ID', () => {
      const result = engine.validate(
        [createValidTestCase({ testCasePriorityId: 3 })],
        metadata
      );
      expect(result.isValid).toBe(false);
      expect(result.errors[0].field).toBe('TestCasePriorityId');
    });

    it('should error for a non-existent priority ID', () => {
      const result = engine.validate(
        [createValidTestCase({ testCasePriorityId: 999 })],
        metadata
      );
      expect(result.isValid).toBe(false);
      expect(result.errors[0].field).toBe('TestCasePriorityId');
    });

    it('should not error when priority is not set', () => {
      const result = engine.validate(
        [createValidTestCase({ testCasePriorityId: undefined })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });
  });

  describe('Owner validation', () => {
    it('should pass for an active user', () => {
      const result = engine.validate(
        [createValidTestCase({ ownerId: 1 })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should error for an inactive user', () => {
      const result = engine.validate(
        [createValidTestCase({ ownerId: 3 })],
        metadata
      );
      expect(result.isValid).toBe(false);
      expect(result.errors[0].field).toBe('OwnerId');
    });

    it('should not error when owner is not set', () => {
      const result = engine.validate(
        [createValidTestCase({ ownerId: undefined })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });
  });

  describe('Custom property type validation', () => {
    it('should pass for valid text property', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 2, value: 'Some notes' }],
        })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should error when text property gets a number', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 2, value: 42 }],
        })],
        metadata
      );
      expect(result.isValid).toBe(false);
      expect(result.errors[0].field).toBe('CustomProperty_2');
    });

    it('should pass for valid integer property', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 3, value: 5 }],
        })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should error for non-integer decimal in integer field', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 3, value: 3.14 }],
        })],
        metadata
      );
      expect(result.isValid).toBe(false);
    });

    it('should pass for valid decimal property', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 4, value: 3.14 }],
        })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should pass for valid boolean property', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 5, value: true }],
        })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should accept string "true"/"false" for boolean', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 5, value: 'true' }],
        })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should error for invalid boolean string', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 5, value: 'yes' }],
        })],
        metadata
      );
      expect(result.isValid).toBe(false);
    });

    it('should pass for valid date string', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 6, value: '2024-01-15' }],
        })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should error for invalid date string', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 6, value: 'not-a-date' }],
        })],
        metadata
      );
      expect(result.isValid).toBe(false);
    });

    it('should pass for valid user type custom property', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 8, value: 1 }],
        })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should error for inactive user in user type custom property', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 8, value: 3 }],
        })],
        metadata
      );
      expect(result.isValid).toBe(false);
    });

    it('should skip validation for null custom property values', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 1, value: null }],
        })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });
  });

  describe('Custom list value validation', () => {
    it('should pass for valid list value by name', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 1, value: 'Production' }],
        })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should pass for valid list value by ID', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 1, value: 101 }],
        })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should error for inactive list value by name', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 1, value: 'Dev' }],
        })],
        metadata
      );
      expect(result.isValid).toBe(false);
      expect(result.errors[0].severity).toBe('error');
    });

    it('should error for non-existent list value', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 1, value: 'NonExistent' }],
        })],
        metadata
      );
      expect(result.isValid).toBe(false);
    });

    it('should pass for valid multilist values', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 7, value: 'Smoke, Regression' }],
        })],
        metadata
      );
      expect(result.isValid).toBe(true);
    });

    it('should error when any multilist value is invalid', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 7, value: 'Smoke, Invalid' }],
        })],
        metadata
      );
      expect(result.isValid).toBe(false);
    });

    it('should error for inactive multilist value', () => {
      const result = engine.validate(
        [createValidTestCase({
          customProperties: [{ propertyNumber: 7, value: 'Archived' }],
        })],
        metadata
      );
      expect(result.isValid).toBe(false);
    });
  });

  describe('Stats computation', () => {
    it('should compute correct stats for all valid test cases', () => {
      const testCases = [
        createValidTestCase({ sourceRowIndex: 0, testSteps: [{ description: 'Step 1', position: 1 }] }),
        createValidTestCase({ sourceRowIndex: 1, name: 'Another Test', testSteps: [{ description: 'Step A', position: 1 }, { description: 'Step B', position: 2 }] }),
      ];
      const result = engine.validate(testCases, metadata);

      expect(result.stats.totalTestCases).toBe(2);
      expect(result.stats.validTestCases).toBe(2);
      expect(result.stats.totalTestSteps).toBe(3);
      expect(result.stats.errorCount).toBe(0);
      expect(result.stats.warningCount).toBe(0);
    });

    it('should compute correct stats with errors', () => {
      const testCases = [
        createValidTestCase({ sourceRowIndex: 0 }),
        createValidTestCase({ sourceRowIndex: 1, name: '' }),
        createValidTestCase({ sourceRowIndex: 2, testCaseStatusId: 999 }),
      ];
      const result = engine.validate(testCases, metadata);

      expect(result.stats.totalTestCases).toBe(3);
      expect(result.stats.validTestCases).toBe(1);
      expect(result.stats.errorCount).toBe(2);
    });

    it('should distinguish warnings from errors in stats', () => {
      const testCases = [
        createValidTestCase({
          sourceRowIndex: 0,
          customProperties: [{ propertyNumber: 99, value: 'something' }],
        }),
      ];
      const result = engine.validate(testCases, metadata);

      expect(result.stats.warningCount).toBe(1);
      expect(result.stats.errorCount).toBe(0);
      expect(result.stats.validTestCases).toBe(1);
      expect(result.isValid).toBe(true);
    });
  });

  describe('Multiple errors aggregation', () => {
    it('should report multiple errors for the same test case', () => {
      const testCases = [
        createValidTestCase({
          sourceRowIndex: 0,
          name: '',
          testCaseStatusId: 999,
          ownerId: 999,
        }),
      ];
      const result = engine.validate(testCases, metadata);

      expect(result.errors.length).toBe(3);
      expect(result.errors.every((e) => e.rowIndex === 0)).toBe(true);
    });

    it('should report errors for multiple rows with correct row indices', () => {
      const testCases = [
        createValidTestCase({ sourceRowIndex: 0, name: '' }),
        createValidTestCase({ sourceRowIndex: 1, name: 'Valid' }),
        createValidTestCase({ sourceRowIndex: 2, name: '' }),
      ];
      const result = engine.validate(testCases, metadata);

      expect(result.errors.length).toBe(2);
      expect(result.errors[0].rowIndex).toBe(0);
      expect(result.errors[1].rowIndex).toBe(2);
    });
  });
});
