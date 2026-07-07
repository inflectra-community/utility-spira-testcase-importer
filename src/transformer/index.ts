/**
 * Data Transformer - Applies confirmed mappings to source rows,
 * producing Spira-ready TransformedTestCase objects.
 */

import type {
  MappingResult,
  FieldMapping,
  TestStepMappingConfig,
  FolderMappingConfig,
} from '../types/mapping.js';
import type { TemplateMetadata } from '../types/spira.js';
import type {
  TransformedTestCase,
  TransformedTestStep,
  CustomPropertyValue,
  TransformationResult,
  TransformationError,
  TransformationWarning,
} from '../types/transform.js';

export interface DataTransformer {
  transform(
    rows: Record<string, unknown>[],
    mapping: MappingResult,
    metadata: TemplateMetadata
  ): TransformationResult;
}

/**
 * Applies a direct transform: copies the source value as-is to the target field.
 */
function applyDirectTransform(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

/**
 * Applies a lookup transform: maps the source value through a lookupMap to a Spira ID/value.
 */
function applyLookupTransform(
  value: unknown,
  lookupMap: Record<string, number | string> | undefined,
  rowIndex: number,
  field: string,
  errors: TransformationError[]
): number | string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (!lookupMap) {
    errors.push({
      rowIndex,
      field,
      message: `Lookup transform specified but no lookupMap provided for field "${field}"`,
      severity: 'error',
    });
    return null;
  }

  const sourceStr = String(value).trim();
  const mapped = lookupMap[sourceStr];

  if (mapped === undefined) {
    // Try case-insensitive match
    const lowerKey = sourceStr.toLowerCase();
    const match = Object.entries(lookupMap).find(
      ([k]) => k.toLowerCase() === lowerKey
    );
    if (match) {
      return match[1];
    }

    errors.push({
      rowIndex,
      field,
      message: `Value "${sourceStr}" not found in lookup map for field "${field}". Available keys: ${Object.keys(lookupMap).join(', ')}`,
      severity: 'warning',
    });
    return null;
  }

  return mapped;
}

/**
 * Applies a template transform: combines multiple source columns using a pattern like "{Col1} - {Col2}".
 */
function applyTemplateTransform(
  row: Record<string, unknown>,
  templatePattern: string | undefined,
  rowIndex: number,
  field: string,
  errors: TransformationError[]
): string | null {
  if (!templatePattern) {
    errors.push({
      rowIndex,
      field,
      message: `Template transform specified but no templatePattern provided for field "${field}"`,
      severity: 'error',
    });
    return null;
  }

  let result = templatePattern;
  const placeholderRegex = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = placeholderRegex.exec(templatePattern)) !== null) {
    const columnName = match[1];
    const value = row[columnName];
    const replacement = value !== null && value !== undefined ? String(value) : '';
    result = result.replace(match[0], replacement);
  }

  return result || null;
}

/**
 * Extracts test steps in inline mode: splits a cell value by a delimiter.
 */
function extractInlineTestSteps(
  row: Record<string, unknown>,
  stepConfig: TestStepMappingConfig
): TransformedTestStep[] {
  const delimiter = stepConfig.stepDelimiter || '\n';
  const steps: TransformedTestStep[] = [];

  const descriptionRaw = stepConfig.descriptionColumn
    ? row[stepConfig.descriptionColumn]
    : undefined;
  const expectedResultRaw = stepConfig.expectedResultColumn
    ? row[stepConfig.expectedResultColumn]
    : undefined;
  const sampleDataRaw = stepConfig.sampleDataColumn
    ? row[stepConfig.sampleDataColumn]
    : undefined;

  if (!descriptionRaw && !expectedResultRaw && !sampleDataRaw) {
    return steps;
  }

  const descriptions = descriptionRaw
    ? String(descriptionRaw).split(delimiter)
    : [];
  const expectedResults = expectedResultRaw
    ? String(expectedResultRaw).split(delimiter)
    : [];
  const sampleDataEntries = sampleDataRaw
    ? String(sampleDataRaw).split(delimiter)
    : [];

  const maxLength = Math.max(
    descriptions.length,
    expectedResults.length,
    sampleDataEntries.length
  );

  for (let i = 0; i < maxLength; i++) {
    const desc = descriptions[i]?.trim();
    const expected = expectedResults[i]?.trim();
    const sample = sampleDataEntries[i]?.trim();

    // Skip empty steps
    if (!desc && !expected && !sample) {
      continue;
    }

    steps.push({
      description: desc || '',
      expectedResult: expected || undefined,
      sampleData: sample || undefined,
      position: steps.length + 1,
    });
  }

  return steps;
}

/**
 * Known standard Spira test case fields and where to assign their values.
 */
const STANDARD_FIELD_MAP: Record<string, string> = {
  name: 'name',
  description: 'description',
  testcasepriorityid: 'testCasePriorityId',
  testcasestatusid: 'testCaseStatusId',
  testcasetypeid: 'testCaseTypeId',
  ownerid: 'ownerId',
  tags: 'tags',
};

/**
 * Determines if a target field is a custom property by checking against metadata.
 */
function findCustomProperty(
  targetField: string,
  metadata: TemplateMetadata
): { propertyNumber: number } | null {
  const cp = metadata.customProperties.find(
    (p) => p.name.toLowerCase() === targetField.toLowerCase()
  );
  if (cp) {
    return { propertyNumber: cp.propertyNumber };
  }
  return null;
}

/**
 * Transforms a single row into a TransformedTestCase.
 */
function transformRow(
  row: Record<string, unknown>,
  rowIndex: number,
  mapping: MappingResult,
  metadata: TemplateMetadata,
  errors: TransformationError[],
  warnings: TransformationWarning[]
): TransformedTestCase {
  const testCase: TransformedTestCase = {
    sourceRowIndex: rowIndex,
    name: '',
    customProperties: [],
    testSteps: [],
  };

  for (const fieldMapping of mapping.fieldMappings) {
    if (fieldMapping.transformType === 'ignore') {
      continue;
    }

    const sourceValue = row[fieldMapping.sourceColumn];
    let transformedValue: string | number | boolean | null = null;

    switch (fieldMapping.transformType) {
      case 'direct':
        transformedValue = applyDirectTransform(sourceValue);
        break;

      case 'lookup':
        transformedValue = applyLookupTransform(
          sourceValue,
          fieldMapping.lookupMap,
          rowIndex,
          fieldMapping.targetField,
          errors
        );
        break;

      case 'template':
        transformedValue = applyTemplateTransform(
          row,
          fieldMapping.templatePattern,
          rowIndex,
          fieldMapping.targetField,
          errors
        );
        break;
    }

    // Assign transformed value to the correct field
    assignFieldValue(testCase, fieldMapping, transformedValue, metadata, rowIndex, errors);
  }

  // Extract folder path if configured
  if (mapping.folderMapping) {
    testCase.folderPath = extractFolderPath(row, mapping.folderMapping);
  }

  // Extract test steps if configured (inline mode)
  if (mapping.testStepMapping && mapping.testStepMapping.mode === 'inline') {
    testCase.testSteps = extractInlineTestSteps(row, mapping.testStepMapping);
  }

  // Add a warning if the test case has no name
  if (!testCase.name) {
    warnings.push({
      rowIndex,
      field: 'name',
      message: `Row ${rowIndex} has no value mapped to the Name field`,
      severity: 'warning',
    });
  }

  return testCase;
}

/**
 * Assigns a transformed value to the correct field on the test case.
 */
function assignFieldValue(
  testCase: TransformedTestCase,
  fieldMapping: FieldMapping,
  value: string | number | boolean | null,
  metadata: TemplateMetadata,
  rowIndex: number,
  errors: TransformationError[]
): void {
  if (value === null) {
    return;
  }

  const targetLower = fieldMapping.targetField.toLowerCase();
  const standardField = STANDARD_FIELD_MAP[targetLower];

  if (standardField) {
    switch (standardField) {
      case 'name':
        testCase.name = String(value);
        break;
      case 'description':
        testCase.description = String(value);
        break;
      case 'testCasePriorityId':
        testCase.testCasePriorityId = toNumber(value, rowIndex, fieldMapping.targetField, errors);
        break;
      case 'testCaseStatusId':
        testCase.testCaseStatusId = toNumber(value, rowIndex, fieldMapping.targetField, errors);
        break;
      case 'testCaseTypeId':
        testCase.testCaseTypeId = toNumber(value, rowIndex, fieldMapping.targetField, errors);
        break;
      case 'ownerId':
        testCase.ownerId = toNumber(value, rowIndex, fieldMapping.targetField, errors);
        break;
      case 'tags':
        testCase.tags = String(value);
        break;
    }
    return;
  }

  // Check if it's a component mapping
  if (targetLower === 'componentids' || targetLower === 'components') {
    const numVal = toNumber(value, rowIndex, fieldMapping.targetField, errors);
    if (numVal !== undefined) {
      if (!testCase.componentIds) {
        testCase.componentIds = [];
      }
      testCase.componentIds.push(numVal);
    }
    return;
  }

  // Check if it's a custom property
  const customProp = findCustomProperty(fieldMapping.targetField, metadata);
  if (customProp) {
    testCase.customProperties.push({
      propertyNumber: customProp.propertyNumber,
      value: value,
    });
    return;
  }

  // Unknown field — add a warning
  errors.push({
    rowIndex,
    field: fieldMapping.targetField,
    message: `Unknown target field "${fieldMapping.targetField}" — value was not assigned`,
    severity: 'warning',
  });
}

/**
 * Safely convert a value to a number, recording an error if conversion fails.
 */
function toNumber(
  value: string | number | boolean | null,
  rowIndex: number,
  field: string,
  errors: TransformationError[]
): number | undefined {
  if (value === null) return undefined;
  if (typeof value === 'number') return value;
  const num = Number(value);
  if (isNaN(num)) {
    errors.push({
      rowIndex,
      field,
      message: `Cannot convert value "${value}" to number for field "${field}"`,
      severity: 'error',
    });
    return undefined;
  }
  return num;
}

/**
 * Extracts the folder path from the row based on folder mapping config.
 */
function extractFolderPath(
  row: Record<string, unknown>,
  folderMapping: FolderMappingConfig
): string | undefined {
  const raw = row[folderMapping.sourceColumn];
  if (raw === null || raw === undefined || raw === '') {
    return undefined;
  }
  return String(raw).trim();
}

/**
 * Groups rows by parent test case for separate-rows step extraction mode.
 * In this mode, consecutive rows that lack a test case name are treated as
 * test steps belonging to the preceding row that has a name.
 */
function transformSeparateRowsMode(
  rows: Record<string, unknown>[],
  mapping: MappingResult,
  metadata: TemplateMetadata
): TransformationResult {
  const errors: TransformationError[] = [];
  const warnings: TransformationWarning[] = [];
  const testCases: TransformedTestCase[] = [];

  // Find the field mapping that targets "Name" to identify parent rows
  const nameMapping = mapping.fieldMappings.find(
    (fm) => fm.targetField.toLowerCase() === 'name'
  );

  let currentTestCase: TransformedTestCase | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const stepConfig = mapping.testStepMapping!;

    // Determine if this row is a parent test case or a step row
    const nameValue = nameMapping ? row[nameMapping.sourceColumn] : undefined;
    const hasName = nameValue !== null && nameValue !== undefined && String(nameValue).trim() !== '';

    if (hasName) {
      // This is a parent test case row
      if (currentTestCase) {
        testCases.push(currentTestCase);
      }
      currentTestCase = transformRow(row, i, mapping, metadata, errors, warnings);

      // Also extract a step from this row if step columns are present
      const step = extractStepFromRow(row, stepConfig);
      if (step) {
        step.position = currentTestCase.testSteps.length + 1;
        currentTestCase.testSteps.push(step);
      }
    } else {
      // This is a step row belonging to the current test case
      if (!currentTestCase) {
        warnings.push({
          rowIndex: i,
          field: 'testSteps',
          message: `Row ${i} appears to be a test step but no parent test case precedes it`,
          severity: 'warning',
        });
        continue;
      }

      const step = extractStepFromRow(row, stepConfig);
      if (step) {
        step.position = currentTestCase.testSteps.length + 1;
        currentTestCase.testSteps.push(step);
      }
    }
  }

  // Push the last test case
  if (currentTestCase) {
    testCases.push(currentTestCase);
  }

  return { testCases, errors, warnings };
}

/**
 * Extracts a single test step from a row using the step mapping config columns.
 */
function extractStepFromRow(
  row: Record<string, unknown>,
  stepConfig: TestStepMappingConfig
): TransformedTestStep | null {
  const desc = stepConfig.descriptionColumn
    ? row[stepConfig.descriptionColumn]
    : undefined;
  const expected = stepConfig.expectedResultColumn
    ? row[stepConfig.expectedResultColumn]
    : undefined;
  const sample = stepConfig.sampleDataColumn
    ? row[stepConfig.sampleDataColumn]
    : undefined;

  if (!desc && !expected && !sample) {
    return null;
  }

  return {
    description: desc ? String(desc).trim() : '',
    expectedResult: expected ? String(expected).trim() : undefined,
    sampleData: sample ? String(sample).trim() : undefined,
    position: 0, // caller will assign
  };
}

/**
 * Creates and returns a DataTransformer implementation.
 */
export function createDataTransformer(): DataTransformer {
  return {
    transform(
      rows: Record<string, unknown>[],
      mapping: MappingResult,
      metadata: TemplateMetadata
    ): TransformationResult {
      // If separate-rows mode, use the grouping logic
      if (mapping.testStepMapping?.mode === 'separate-rows') {
        return transformSeparateRowsMode(rows, mapping, metadata);
      }

      // Standard mode: one test case per row
      const errors: TransformationError[] = [];
      const warnings: TransformationWarning[] = [];
      const testCases: TransformedTestCase[] = [];

      for (let i = 0; i < rows.length; i++) {
        const testCase = transformRow(
          rows[i],
          i,
          mapping,
          metadata,
          errors,
          warnings
        );
        testCases.push(testCase);
      }

      return { testCases, errors, warnings };
    },
  };
}
