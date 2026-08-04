/**
 * Validation Engine — validates transformed artifacts against Spira schema constraints.
 *
 * The engine supports two modes:
 * 1. Built-in test-case rules (backward compatible, no config needed)
 * 2. Strategy-provided rules via ValidationEngineConfig
 *
 * Custom property validation (type checking, list value matching) is always applied
 * regardless of mode — it's universal across all artifact types.
 */

import type { TransformedTestCase } from '../types/transform.js';
import type {
  TemplateMetadata,
  CustomPropertyDefinition,
  CustomListValue,
} from '../types/spira.js';
import type { ValidationError, ValidationResult } from '../types/validation.js';
import type { ValidationRule, ArtifactMetadata, TransformedArtifact } from '../types/strategy.js';

export interface ValidationEngine {
  validate(
    testCases: TransformedTestCase[],
    metadata: TemplateMetadata
  ): ValidationResult;
}

/**
 * Configuration for the validation engine.
 * When externalRules are provided, they replace the built-in test-case-specific rules.
 * Custom property validation is always applied regardless.
 */
export interface ValidationEngineConfig {
  /** Strategy-provided validation rules. If set, replaces built-in artifact-specific rules. */
  externalRules?: ValidationRule[];
}

/**
 * Creates a ValidationEngine that checks transformed test cases against
 * the Spira template metadata constraints.
 *
 * @param config - Optional configuration. If externalRules are provided,
 *                 they replace the built-in test-case-specific rules.
 *                 Custom property validation is always applied.
 */
export function createValidationEngine(config?: ValidationEngineConfig): ValidationEngine {
  return {
    validate(
      testCases: TransformedTestCase[],
      metadata: TemplateMetadata
    ): ValidationResult {
      const errors: ValidationError[] = [];
      const warnings: ValidationError[] = [];
      let totalTestSteps = 0;

      for (const testCase of testCases) {
        let rowErrors: ValidationError[];

        if (config?.externalRules) {
          // Use strategy-provided rules + universal custom property validation
          rowErrors = validateWithExternalRules(testCase, metadata, config.externalRules);
        } else {
          // Use built-in test-case-specific rules
          rowErrors = validateTestCase(testCase, metadata);
        }

        for (const err of rowErrors) {
          if (err.severity === 'error') {
            errors.push(err);
          } else {
            warnings.push(err);
          }
        }

        totalTestSteps += testCase.testSteps.length;
      }

      const errorCount = errors.length;
      const warningCount = warnings.length;

      // A test case is valid if it has no errors for its row
      const rowsWithErrors = new Set(errors.map((e) => e.rowIndex));
      const validTestCases = testCases.filter(
        (tc) => !rowsWithErrors.has(tc.sourceRowIndex)
      ).length;

      return {
        isValid: errorCount === 0,
        errors,
        warnings,
        stats: {
          totalTestCases: testCases.length,
          validTestCases,
          totalTestSteps,
          errorCount,
          warningCount,
        },
      };
    },
  };
}

/**
 * Validates a test case using strategy-provided external rules plus
 * universal custom property validation.
 */
function validateWithExternalRules(
  testCase: TransformedTestCase,
  metadata: TemplateMetadata,
  rules: ValidationRule[],
): ValidationError[] {
  const issues: ValidationError[] = [];

  // Convert TransformedTestCase to TransformedArtifact for the strategy rules
  const artifact: TransformedArtifact = {
    sourceRowIndex: testCase.sourceRowIndex,
    name: testCase.name,
    fields: {
      Name: testCase.name,
      Description: testCase.description ?? null,
      TestCasePriorityId: testCase.testCasePriorityId ?? null,
      TestCaseStatusId: testCase.testCaseStatusId ?? null,
      TestCaseTypeId: testCase.testCaseTypeId ?? null,
      OwnerId: testCase.ownerId ?? null,
      Tags: testCase.tags ?? null,
    },
    customProperties: testCase.customProperties.map(cp => ({
      propertyNumber: cp.propertyNumber,
      value: cp.value,
    })),
    subItems: testCase.testSteps.map(s => ({
      description: s.description,
      expectedResult: s.expectedResult,
      sampleData: s.sampleData,
      position: s.position,
    })),
    folderPath: testCase.folderPath,
    tags: testCase.tags,
  };

  // Convert TemplateMetadata to ArtifactMetadata for the strategy rules
  const artifactMetadata: ArtifactMetadata = {
    projectId: metadata.projectId,
    templateId: metadata.templateId,
    customProperties: metadata.customProperties,
    customLists: metadata.customLists,
    users: metadata.users,
    components: metadata.components,
    lookups: [
      {
        fieldName: 'TestCasePriorityId',
        label: 'Priorities',
        entries: metadata.priorities.map(p => ({ id: p.priorityId, name: p.name, active: p.active })),
      },
      {
        fieldName: 'TestCaseStatusId',
        label: 'Statuses',
        entries: metadata.statuses.map(s => ({ id: s.testCaseStatusId, name: s.name, active: s.active })),
      },
      {
        fieldName: 'TestCaseTypeId',
        label: 'Types',
        entries: metadata.types.map(t => ({ id: t.testCaseTypeId, name: t.name, active: t.active })),
      },
    ],
    existingFolders: metadata.existingFolders.map(f => ({
      id: f.testCaseFolderId,
      name: f.name,
      parentId: f.parentTestCaseFolderId,
      indentLevel: f.indentLevel,
    })),
  };

  // Run each external rule
  for (const rule of rules) {
    const ruleIssues = rule(artifact, artifactMetadata);
    issues.push(...ruleIssues);
  }

  // Always run custom property validation (universal across all artifact types)
  for (const cpValue of testCase.customProperties) {
    const propDef = metadata.customProperties.find(
      (cp) => cp.propertyNumber === cpValue.propertyNumber
    );

    if (!propDef) {
      issues.push({
        rowIndex: testCase.sourceRowIndex,
        field: `CustomProperty_${cpValue.propertyNumber}`,
        message: `Custom property number ${cpValue.propertyNumber} is not defined in the template`,
        severity: 'warning',
      });
      continue;
    }

    if (cpValue.value == null) continue;

    const typeIssues = validateCustomPropertyType(
      testCase.sourceRowIndex,
      propDef,
      cpValue.value,
      metadata,
    );
    issues.push(...typeIssues);
  }

  return issues;
}

/**
 * Validates a single test case against all rules. Returns all validation issues found.
 */
function validateTestCase(
  testCase: TransformedTestCase,
  metadata: TemplateMetadata
): ValidationError[] {
  const issues: ValidationError[] = [];
  const row = testCase.sourceRowIndex;

  // Rule 1: Required field — Name must be non-empty
  if (!testCase.name || testCase.name.trim().length === 0) {
    issues.push({
      rowIndex: row,
      field: 'Name',
      message: 'Name is required and must not be empty',
      severity: 'error',
    });
  }

  // Rule 2: Status must reference a valid template value
  if (testCase.testCaseStatusId != null) {
    const validStatus = metadata.statuses.find(
      (s) => s.testCaseStatusId === testCase.testCaseStatusId
    );
    if (!validStatus) {
      issues.push({
        rowIndex: row,
        field: 'TestCaseStatusId',
        message: `Status ID ${testCase.testCaseStatusId} does not match any valid status in the template`,
        severity: 'error',
      });
    }
  }

  // Rule 3: Type must reference a valid template value
  if (testCase.testCaseTypeId != null) {
    const validType = metadata.types.find(
      (t) => t.testCaseTypeId === testCase.testCaseTypeId
    );
    if (!validType) {
      issues.push({
        rowIndex: row,
        field: 'TestCaseTypeId',
        message: `Type ID ${testCase.testCaseTypeId} does not match any valid type in the template`,
        severity: 'error',
      });
    }
  }

  // Rule 4: Priority (if set) must reference an active priority
  if (testCase.testCasePriorityId != null) {
    const validPriority = metadata.priorities.find(
      (p) => p.priorityId === testCase.testCasePriorityId && p.active
    );
    if (!validPriority) {
      issues.push({
        rowIndex: row,
        field: 'TestCasePriorityId',
        message: `Priority ID ${testCase.testCasePriorityId} does not match any active priority in the template`,
        severity: 'error',
      });
    }
  }

  // Rule 5: Owner (if set) must reference an active project member
  if (testCase.ownerId != null) {
    const validUser = metadata.users.find(
      (u) => u.userId === testCase.ownerId && u.active
    );
    if (!validUser) {
      issues.push({
        rowIndex: row,
        field: 'OwnerId',
        message: `Owner ID ${testCase.ownerId} does not match any active project member`,
        severity: 'error',
      });
    }
  }

  // Rule 6 & 7: Custom property validation (type + list values)
  for (const cpValue of testCase.customProperties) {
    const propDef = metadata.customProperties.find(
      (cp) => cp.propertyNumber === cpValue.propertyNumber
    );

    if (!propDef) {
      issues.push({
        rowIndex: row,
        field: `CustomProperty_${cpValue.propertyNumber}`,
        message: `Custom property number ${cpValue.propertyNumber} is not defined in the template`,
        severity: 'warning',
      });
      continue;
    }

    // Skip validation for null values (field not set)
    if (cpValue.value == null) {
      continue;
    }

    const typeIssues = validateCustomPropertyType(
      row,
      propDef,
      cpValue.value,
      metadata
    );
    issues.push(...typeIssues);
  }

  return issues;
}

/**
 * Validates that a custom property value matches the expected type and,
 * for list/multilist types, that the value references an active list entry.
 *
 * Custom property type IDs:
 *   1=Text, 2=Integer, 3=Decimal, 4=Boolean, 5=Date, 6=List, 7=MultiList, 8=User
 */
function validateCustomPropertyType(
  rowIndex: number,
  propDef: CustomPropertyDefinition,
  value: string | number | boolean,
  metadata: TemplateMetadata
): ValidationError[] {
  const issues: ValidationError[] = [];
  const field = `CustomProperty_${propDef.propertyNumber}`;

  switch (propDef.customPropertyTypeId) {
    case 1: // Text
      if (typeof value !== 'string') {
        issues.push({
          rowIndex,
          field,
          message: `Custom property "${propDef.name}" expects text but got ${typeof value}`,
          severity: 'error',
        });
      }
      break;

    case 2: // Integer
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || isNaN(parsed)) {
          issues.push({
            rowIndex,
            field,
            message: `Custom property "${propDef.name}" expects an integer but got "${value}"`,
            severity: 'error',
          });
        }
      } else if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
          issues.push({
            rowIndex,
            field,
            message: `Custom property "${propDef.name}" expects an integer but got decimal ${value}`,
            severity: 'error',
          });
        }
      } else {
        issues.push({
          rowIndex,
          field,
          message: `Custom property "${propDef.name}" expects an integer but got ${typeof value}`,
          severity: 'error',
        });
      }
      break;

    case 3: // Decimal
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (isNaN(parsed)) {
          issues.push({
            rowIndex,
            field,
            message: `Custom property "${propDef.name}" expects a decimal number but got "${value}"`,
            severity: 'error',
          });
        }
      } else if (typeof value !== 'number') {
        issues.push({
          rowIndex,
          field,
          message: `Custom property "${propDef.name}" expects a decimal number but got ${typeof value}`,
          severity: 'error',
        });
      }
      break;

    case 4: // Boolean
      if (typeof value !== 'boolean') {
        // Also accept string "true"/"false"
        if (typeof value === 'string') {
          const lower = value.toLowerCase();
          if (lower !== 'true' && lower !== 'false') {
            issues.push({
              rowIndex,
              field,
              message: `Custom property "${propDef.name}" expects a boolean but got "${value}"`,
              severity: 'error',
            });
          }
        } else {
          issues.push({
            rowIndex,
            field,
            message: `Custom property "${propDef.name}" expects a boolean but got ${typeof value}`,
            severity: 'error',
          });
        }
      }
      break;

    case 5: // Date
      if (typeof value === 'string') {
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          issues.push({
            rowIndex,
            field,
            message: `Custom property "${propDef.name}" expects a valid date but got "${value}"`,
            severity: 'error',
          });
        }
      } else {
        issues.push({
          rowIndex,
          field,
          message: `Custom property "${propDef.name}" expects a date string but got ${typeof value}`,
          severity: 'error',
        });
      }
      break;

    case 6: // List
      validateListValue(rowIndex, propDef, value, metadata, issues);
      break;

    case 7: // MultiList
      validateMultiListValue(rowIndex, propDef, value, metadata, issues);
      break;

    case 8: // User
      if (typeof value === 'number') {
        const validUser = metadata.users.find(
          (u) => u.userId === value && u.active
        );
        if (!validUser) {
          issues.push({
            rowIndex,
            field,
            message: `Custom property "${propDef.name}" references user ID ${value} which is not an active project member`,
            severity: 'error',
          });
        }
      } else {
        issues.push({
          rowIndex,
          field,
          message: `Custom property "${propDef.name}" expects a user ID (number) but got ${typeof value}`,
          severity: 'error',
        });
      }
      break;

    default:
      issues.push({
        rowIndex,
        field,
        message: `Custom property "${propDef.name}" has unknown type ID ${propDef.customPropertyTypeId}`,
        severity: 'warning',
      });
  }

  return issues;
}

/**
 * Validates a single-select list value against the active entries in the custom list.
 * The value can be either the numeric ID of a list entry or the string name.
 */
function validateListValue(
  rowIndex: number,
  propDef: CustomPropertyDefinition,
  value: string | number | boolean,
  metadata: TemplateMetadata,
  issues: ValidationError[]
): void {
  const field = `CustomProperty_${propDef.propertyNumber}`;

  if (propDef.customListId == null) {
    issues.push({
      rowIndex,
      field,
      message: `Custom property "${propDef.name}" is a list type but has no associated custom list`,
      severity: 'warning',
    });
    return;
  }

  const listValues = metadata.customLists.get(propDef.customListId);
  if (!listValues) {
    issues.push({
      rowIndex,
      field,
      message: `Custom list ID ${propDef.customListId} for property "${propDef.name}" was not found in metadata`,
      severity: 'warning',
    });
    return;
  }

  const activeEntries = listValues.filter((lv) => lv.active);

  if (typeof value === 'number') {
    // Value is the list entry ID
    const match = activeEntries.find(
      (lv) => lv.customPropertyValueId === value
    );
    if (!match) {
      issues.push({
        rowIndex,
        field,
        message: `Custom property "${propDef.name}" value ID ${value} does not match any active list entry`,
        severity: 'error',
      });
    }
  } else if (typeof value === 'string') {
    // Value is the list entry name
    const match = activeEntries.find(
      (lv) => lv.name.toLowerCase() === value.toLowerCase()
    );
    if (!match) {
      issues.push({
        rowIndex,
        field,
        message: `Custom property "${propDef.name}" value "${value}" does not match any active list entry`,
        severity: 'error',
      });
    }
  } else {
    issues.push({
      rowIndex,
      field,
      message: `Custom property "${propDef.name}" expects a list value (string or number) but got ${typeof value}`,
      severity: 'error',
    });
  }
}

/**
 * Validates a multi-select list value. The value can be:
 * - A number (single selection by ID)
 * - A string with comma-separated names
 * Each entry must match an active list entry.
 */
function validateMultiListValue(
  rowIndex: number,
  propDef: CustomPropertyDefinition,
  value: string | number | boolean,
  metadata: TemplateMetadata,
  issues: ValidationError[]
): void {
  const field = `CustomProperty_${propDef.propertyNumber}`;

  if (propDef.customListId == null) {
    issues.push({
      rowIndex,
      field,
      message: `Custom property "${propDef.name}" is a multilist type but has no associated custom list`,
      severity: 'warning',
    });
    return;
  }

  const listValues = metadata.customLists.get(propDef.customListId);
  if (!listValues) {
    issues.push({
      rowIndex,
      field,
      message: `Custom list ID ${propDef.customListId} for property "${propDef.name}" was not found in metadata`,
      severity: 'warning',
    });
    return;
  }

  const activeEntries = listValues.filter((lv) => lv.active);

  if (typeof value === 'number') {
    // Single ID selection
    const match = activeEntries.find(
      (lv) => lv.customPropertyValueId === value
    );
    if (!match) {
      issues.push({
        rowIndex,
        field,
        message: `Custom property "${propDef.name}" value ID ${value} does not match any active list entry`,
        severity: 'error',
      });
    }
  } else if (typeof value === 'string') {
    // Comma-separated names
    const names = value.split(',').map((n) => n.trim()).filter((n) => n.length > 0);
    for (const name of names) {
      const match = activeEntries.find(
        (lv) => lv.name.toLowerCase() === name.toLowerCase()
      );
      if (!match) {
        issues.push({
          rowIndex,
          field,
          message: `Custom property "${propDef.name}" value "${name}" does not match any active list entry`,
          severity: 'error',
        });
      }
    }
  } else {
    issues.push({
      rowIndex,
      field,
      message: `Custom property "${propDef.name}" expects a multilist value (string or number) but got ${typeof value}`,
      severity: 'error',
    });
  }
}
