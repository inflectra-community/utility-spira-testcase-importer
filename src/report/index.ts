/**
 * Mapping Validation Report Generator
 *
 * Generates a structured, terminal-friendly report summarizing the results
 * of data transformation and validation against the Spira schema.
 *
 * Validates: Requirements 6.5
 */

import type { TransformationResult, TransformedTestCase } from '../types/transform.js';
import type { ValidationResult } from '../types/validation.js';
import type { MappingResult } from '../types/mapping.js';

const SEPARATOR = '═'.repeat(60);
const THIN_SEPARATOR = '─'.repeat(60);
const MAX_SAMPLE_RECORDS = 5;

/**
 * Generates a human-readable validation report for terminal display.
 *
 * Sections:
 *  1. Header
 *  2. Summary statistics
 *  3. Field mapping summary
 *  4. Sample transformed records (first 3-5)
 *  5. Errors
 *  6. Warnings
 */
export function generateValidationReport(
  transformResult: TransformationResult,
  validationResult: ValidationResult,
  mapping: MappingResult
): string {
  const sections: string[] = [];

  sections.push(renderHeader());
  sections.push(renderSummary(validationResult));
  sections.push(renderFieldMappingSummary(mapping));
  sections.push(renderSampleRecords(transformResult.testCases));
  sections.push(renderErrors(validationResult));
  sections.push(renderWarnings(validationResult));

  return sections.join('\n\n');
}

function renderHeader(): string {
  return [
    SEPARATOR,
    '  Mapping Validation Report',
    SEPARATOR,
  ].join('\n');
}

function renderSummary(validationResult: ValidationResult): string {
  const { stats } = validationResult;
  const lines: string[] = [
    '📊 Summary',
    THIN_SEPARATOR,
    `  Total test cases:   ${stats.totalTestCases}`,
    `  Valid test cases:   ${stats.validTestCases}`,
    `  Total test steps:   ${stats.totalTestSteps}`,
    `  Errors:             ${stats.errorCount}`,
    `  Warnings:           ${stats.warningCount}`,
  ];
  return lines.join('\n');
}

function renderFieldMappingSummary(mapping: MappingResult): string {
  const lines: string[] = [
    '🗺️  Field Mapping Summary',
    THIN_SEPARATOR,
  ];

  if (mapping.fieldMappings.length === 0) {
    lines.push('  (no field mappings)');
    return lines.join('\n');
  }

  // Calculate column widths for alignment
  const sourceMaxLen = Math.max(
    ...mapping.fieldMappings.map(m => m.sourceColumn.length),
    'Source Column'.length
  );
  const targetMaxLen = Math.max(
    ...mapping.fieldMappings.map(m => m.targetField.length),
    'Target Field'.length
  );

  const headerLine = `  ${'Source Column'.padEnd(sourceMaxLen)}  →  ${'Target Field'.padEnd(targetMaxLen)}  (Transform)`;
  const headerSep = `  ${'─'.repeat(sourceMaxLen)}  ${'─'.repeat(3)}  ${'─'.repeat(targetMaxLen)}  ${'─'.repeat(11)}`;

  lines.push(headerLine);
  lines.push(headerSep);

  for (const fm of mapping.fieldMappings) {
    const source = fm.sourceColumn.padEnd(sourceMaxLen);
    const target = fm.targetField.padEnd(targetMaxLen);
    lines.push(`  ${source}  →  ${target}  (${fm.transformType})`);
  }

  return lines.join('\n');
}

function renderSampleRecords(testCases: TransformedTestCase[]): string {
  const lines: string[] = [
    '📋 Sample Transformed Records',
    THIN_SEPARATOR,
  ];

  if (testCases.length === 0) {
    lines.push('  (no test cases)');
    return lines.join('\n');
  }

  const sampleCount = Math.min(testCases.length, MAX_SAMPLE_RECORDS);
  lines.push(`  Showing ${sampleCount} of ${testCases.length} records:\n`);

  for (let i = 0; i < sampleCount; i++) {
    const tc = testCases[i];
    lines.push(`  [${i + 1}] Row ${tc.sourceRowIndex}`);
    lines.push(`      Name:        ${tc.name || '(empty)'}`);
    if (tc.description) {
      lines.push(`      Description: ${truncate(tc.description, 60)}`);
    }
    if (tc.testCasePriorityId !== undefined) {
      lines.push(`      Priority ID: ${tc.testCasePriorityId}`);
    }
    if (tc.testCaseStatusId !== undefined) {
      lines.push(`      Status ID:   ${tc.testCaseStatusId}`);
    }
    if (tc.testCaseTypeId !== undefined) {
      lines.push(`      Type ID:     ${tc.testCaseTypeId}`);
    }
    if (tc.ownerId !== undefined) {
      lines.push(`      Owner ID:    ${tc.ownerId}`);
    }
    if (tc.folderPath) {
      lines.push(`      Folder:      ${tc.folderPath}`);
    }
    lines.push(`      Test Steps:  ${tc.testSteps.length}`);
    if (i < sampleCount - 1) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderErrors(validationResult: ValidationResult): string {
  const lines: string[] = [
    '❌ Errors',
    THIN_SEPARATOR,
  ];

  if (validationResult.errors.length === 0) {
    lines.push('  No errors found.');
    return lines.join('\n');
  }

  lines.push(`  ${validationResult.errors.length} error(s):\n`);

  for (const err of validationResult.errors) {
    lines.push(`  • Row ${err.rowIndex}, Field "${err.field}": ${err.message}`);
  }

  return lines.join('\n');
}

function renderWarnings(validationResult: ValidationResult): string {
  const lines: string[] = [
    '⚠️  Warnings',
    THIN_SEPARATOR,
  ];

  if (validationResult.warnings.length === 0) {
    lines.push('  No warnings.');
    return lines.join('\n');
  }

  lines.push(`  ${validationResult.warnings.length} warning(s):\n`);

  for (const warn of validationResult.warnings) {
    lines.push(`  • Row ${warn.rowIndex}, Field "${warn.field}": ${warn.message}`);
  }

  return lines.join('\n');
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
