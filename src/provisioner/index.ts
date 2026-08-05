/**
 * SpiraProvisioner Integration
 *
 * Generates a SpiraProvisioner-compatible JSON file from unmatched columns
 * detected during heuristic pre-analysis. This allows admins to extend their
 * Spira product template before re-running the import.
 *
 * Schema reference (live):
 * https://raw.githubusercontent.com/inflectra-community/utility-spira-provisioner/refs/heads/main/spira-structure.schema.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

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
 * Configuration for generating the provisioner file.
 */
export interface ProvisionerExportConfig {
  /** The Spira program name (must already exist) */
  programName: string;
  /** The Spira product name */
  productName: string;
  /** Columns to export as custom fields */
  columns: UnmatchedColumnInfo[];
  /** Max unique values before a field is treated as text instead of list */
  listValueThreshold?: number;
}

/**
 * Determines the appropriate custom field type for a column based on its values.
 *
 * Rules:
 * - If unique values <= threshold (default 20): type = "list" with values
 * - If unique values > threshold: type = "text"
 * - If all values are "true"/"false"/"yes"/"no": type = "boolean"
 * - If all values are integers: type = "integer"
 * - If all values look like dates: type = "date"
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
 * Generates a SpiraProvisioner-compatible JSON structure for the given unmatched columns.
 */
export function generateProvisionerConfig(config: ProvisionerExportConfig): Record<string, unknown> {
  const threshold = config.listValueThreshold ?? 20;

  const customFields = config.columns.map(column => {
    const { type, values } = inferFieldType(column, threshold);
    const field: Record<string, unknown> = {
      name: column.columnName,
      type,
    };
    if (values) {
      field.values = values;
    }
    return field;
  });

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
