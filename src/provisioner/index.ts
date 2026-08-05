/**
 * SpiraProvisioner Integration
 *
 * Generates a SpiraProvisioner-compatible JSON file containing everything
 * the Spira product template needs but doesn't have:
 * - New custom properties (unmatched columns)
 * - Missing list values for existing custom properties
 *
 * Schema reference (live, via GitHub Pages):
 * https://inflectra-community.github.io/utility-spira-provisioner/spira-structure.schema.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CustomPropertyDefinition, CustomListValue } from '../types/spira.js';

const PROVISIONER_SCHEMA_URL =
  'https://inflectra-community.github.io/utility-spira-provisioner/spira-structure.schema.json';

/**
 * Describes an unmatched column that could become a custom property.
 */
export interface UnmatchedColumnInfo {
  /** The source column header name */
  columnName: string;
  /** Unique non-empty values found in this column */
  uniqueValues: string[];
  /** Total number of non-empty rows for this column */
  rowCount: number;
}

/**
 * Describes missing values for an existing list-type custom property.
 */
export interface MissingListValues {
  /** The custom property name in Spira */
  propertyName: string;
  /** Values from the source data that are NOT in the Spira list */
  missingValues: string[];
  /** Values already in the Spira list (for reference) */
  existingValues: string[];
}

/**
 * Configuration for generating the provisioner file.
 */
export interface ProvisionerExportConfig {
  /** The Spira program name (must already exist) */
  programName: string;
  /** The Spira product name */
  productName: string;
  /** Columns to export as new custom fields */
  newColumns: UnmatchedColumnInfo[];
  /** Existing list properties that need additional values */
  missingValues: MissingListValues[];
  /** Max unique values before a field is treated as text instead of list */
  listValueThreshold?: number;
}

/**
 * Determines the appropriate custom field type for a column based on its values.
 */
function inferFieldType(
  column: UnmatchedColumnInfo,
  threshold: number,
): { type: string; values?: string[] } {
  const { uniqueValues } = column;

  if (uniqueValues.length === 0) {
    return { type: 'text' };
  }

  // Check for boolean
  const boolValues = new Set(uniqueValues.map(v => v.toLowerCase()));
  if (boolValues.size <= 2 && [...boolValues].every(v =>
    ['true', 'false', 'yes', 'no', '1', '0'].includes(v)
  )) {
    return { type: 'boolean' };
  }

  // Check for integer
  if (uniqueValues.every(v => /^-?\d+$/.test(v.trim()))) {
    return { type: 'integer' };
  }

  // Check for date patterns
  if (uniqueValues.every(v => !isNaN(Date.parse(v)) && v.length > 6)) {
    return { type: 'date' };
  }

  // List vs text based on cardinality
  if (uniqueValues.length <= threshold) {
    return { type: 'list', values: uniqueValues.sort() };
  }

  return { type: 'text' };
}

/**
 * Generates a SpiraProvisioner-compatible JSON structure.
 * Includes both new custom fields AND existing fields with extended values.
 */
export function generateProvisionerConfig(config: ProvisionerExportConfig): Record<string, unknown> {
  const threshold = config.listValueThreshold ?? 20;

  const customFields: Record<string, unknown>[] = [];

  // New custom properties
  for (const column of config.newColumns) {
    const { type, values } = inferFieldType(column, threshold);
    const field: Record<string, unknown> = { name: column.columnName, type };
    if (values) field.values = values;
    customFields.push(field);
  }

  // Existing list properties with missing values — include ALL values (existing + missing)
  // so the provisioner creates the complete list
  for (const mv of config.missingValues) {
    const allValues = [...new Set([...mv.existingValues, ...mv.missingValues])].sort();
    customFields.push({
      name: mv.propertyName,
      type: 'list',
      values: allValues,
    });
  }

  return {
    $schema: PROVISIONER_SCHEMA_URL,
    program: {
      name: config.programName,
      products: [
        {
          name: config.productName,
          customFields: {
            testCases: customFields,
          },
        },
      ],
    },
  };
}

/**
 * Writes the provisioner config to a JSON file.
 *
 * @returns The absolute path of the written file.
 */
export function writeProvisionerFile(
  config: ProvisionerExportConfig,
  outputDir: string,
  filename?: string,
): string {
  const json = generateProvisionerConfig(config);
  const outputFilename = filename ?? 'spira-provisioner-additions.json';
  const outputPath = path.resolve(outputDir, outputFilename);

  fs.writeFileSync(outputPath, JSON.stringify(json, null, 2), 'utf-8');
  return outputPath;
}

/**
 * Extracts unique values from source rows for a set of column names.
 */
export function extractColumnInfo(
  rows: Record<string, unknown>[],
  columnNames: string[],
): UnmatchedColumnInfo[] {
  return columnNames.map(columnName => {
    const values = new Set<string>();
    let rowCount = 0;

    for (const row of rows) {
      const val = row[columnName];
      if (val != null && String(val).trim() !== '') {
        values.add(String(val).trim());
        rowCount++;
      }
    }

    return {
      columnName,
      uniqueValues: [...values],
      rowCount,
    };
  });
}

/**
 * Identifies missing list values for existing custom properties by comparing
 * the source data values against the template's list entries.
 */
export function findMissingListValues(
  rows: Record<string, unknown>[],
  resolvedMappings: { sourceColumn: string; targetField: string }[],
  customProperties: CustomPropertyDefinition[],
  customLists: Map<number, CustomListValue[]>,
): MissingListValues[] {
  const results: MissingListValues[] = [];

  for (const mapping of resolvedMappings) {
    // Find the custom property this column maps to
    const cp = customProperties.find(p => p.name === mapping.targetField);
    if (!cp || !cp.customListId) continue; // Not a list property

    // Get the list values from Spira
    const listValues = customLists.get(cp.customListId);
    if (!listValues) continue;

    const existingNames = new Set(listValues.map(v => v.name.toLowerCase()));
    const existingValuesList = listValues.map(v => v.name);

    // Collect unique source values for this column
    const sourceValues = new Set<string>();
    for (const row of rows) {
      const val = row[mapping.sourceColumn];
      if (val != null && String(val).trim() !== '') {
        sourceValues.add(String(val).trim());
      }
    }

    // Find values that don't exist in the Spira list
    const missing = [...sourceValues].filter(v => !existingNames.has(v.toLowerCase()));

    if (missing.length > 0) {
      results.push({
        propertyName: cp.name,
        missingValues: missing.sort(),
        existingValues: existingValuesList,
      });
    }
  }

  return results;
}
