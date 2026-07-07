/**
 * Prompt construction for LLM-assisted mapping.
 *
 * Builds a structured prompt that includes Spira field definitions,
 * custom property definitions with list values, source column headers,
 * and sample data rows — instructing the LLM to produce a MappingResult.
 */

import type { TemplateMetadata, CustomPropertyDefinition, CustomListValue } from '../types/spira.js';
import type { SheetData } from '../parser/index.js';

/**
 * Builds the LLM prompt that asks the model to map source spreadsheet columns
 * to Spira test case fields.
 *
 * The prompt includes:
 * - Complete Spira standard field definitions with types/constraints
 * - All custom property definitions with their list values
 * - Source column headers
 * - 3-5 sample data rows
 * - Instructions to produce a structured JSON mapping conforming to MappingResult
 *
 * @param sheet - The parsed spreadsheet data (headers and rows)
 * @param metadata - The Spira template metadata (fields, custom properties, lists)
 * @param sampleRowCount - Number of sample rows to include (default: 5, clamped to available)
 * @returns The constructed prompt string
 */
export function buildMappingPrompt(
  sheet: SheetData,
  metadata: TemplateMetadata,
  sampleRowCount: number = 5,
): string {
  const sections: string[] = [];

  // --- Section 1: System context and goal ---
  sections.push(buildInstructionSection());

  // --- Section 2: Spira standard field definitions ---
  sections.push(buildStandardFieldsSection(metadata));

  // --- Section 3: Custom property definitions with list values ---
  sections.push(buildCustomPropertiesSection(metadata));

  // --- Section 4: Source column headers and sample data ---
  sections.push(buildSourceDataSection(sheet, sampleRowCount));

  // --- Section 5: Output format instructions ---
  sections.push(buildOutputFormatSection());

  return sections.join('\n\n');
}

/**
 * Builds the instruction/context section of the prompt.
 */
function buildInstructionSection(): string {
  return `# Task: Map Spreadsheet Columns to Spira Test Case Fields

You are an expert data mapping assistant. Your job is to analyze source spreadsheet columns and map them to the corresponding Spira test case fields.

For each source column, determine:
1. Which Spira target field it maps to (if any)
2. The transform type: "direct" (copy as-is), "lookup" (map values to IDs), "template" (combine columns), or "ignore" (skip)
3. For "lookup" transforms, provide the value mapping from source values to Spira IDs
4. For "template" transforms, provide the template pattern using {column_name} placeholders

Also determine if the spreadsheet contains test steps and how they are structured (inline within a column, as separate rows, or not present).

Also determine if there is a folder/category column that should define the folder hierarchy.`;
}

/**
 * Builds the standard Spira test case field definitions section.
 */
function buildStandardFieldsSection(metadata: TemplateMetadata): string {
  const lines: string[] = ['# Spira Test Case Standard Fields'];

  lines.push('');
  lines.push('The following are the standard fields available on a Spira Test Case:');
  lines.push('');
  lines.push('| Field | Type | Required | Description |');
  lines.push('|-------|------|----------|-------------|');
  lines.push('| Name | string | Yes | The test case name/title |');
  lines.push('| Description | string (HTML) | No | Detailed description of the test case |');
  lines.push('| TestCasePriorityId | integer | No | Priority level ID |');
  lines.push('| TestCaseStatusId | integer | No | Status ID (default assigned if omitted) |');
  lines.push('| TestCaseTypeId | integer | No | Type ID (default assigned if omitted) |');
  lines.push('| OwnerId | integer | No | Assigned owner user ID |');
  lines.push('| ComponentIds | integer[] | No | Associated component IDs |');
  lines.push('| Tags | string | No | Comma-separated tags |');

  // Priorities
  if (metadata.priorities.length > 0) {
    lines.push('');
    lines.push('## Available Priorities');
    lines.push('');
    lines.push('| ID | Name | Active |');
    lines.push('|----|------|--------|');
    for (const p of metadata.priorities) {
      lines.push(`| ${p.priorityId} | ${p.name} | ${p.active} |`);
    }
  }

  // Statuses
  if (metadata.statuses.length > 0) {
    lines.push('');
    lines.push('## Available Statuses');
    lines.push('');
    lines.push('| ID | Name | Active |');
    lines.push('|----|------|--------|');
    for (const s of metadata.statuses) {
      lines.push(`| ${s.testCaseStatusId} | ${s.name} | ${s.active} |`);
    }
  }

  // Types
  if (metadata.types.length > 0) {
    lines.push('');
    lines.push('## Available Types');
    lines.push('');
    lines.push('| ID | Name | Active | Default |');
    lines.push('|----|------|--------|---------|');
    for (const t of metadata.types) {
      lines.push(`| ${t.testCaseTypeId} | ${t.name} | ${t.active} | ${t.isDefault} |`);
    }
  }

  // Users
  if (metadata.users.length > 0) {
    lines.push('');
    lines.push('## Available Users (for OwnerId)');
    lines.push('');
    lines.push('| ID | Full Name | Username | Active |');
    lines.push('|----|-----------|----------|--------|');
    for (const u of metadata.users) {
      lines.push(`| ${u.userId} | ${u.fullName} | ${u.userName} | ${u.active} |`);
    }
  }

  // Components
  if (metadata.components.length > 0) {
    lines.push('');
    lines.push('## Available Components');
    lines.push('');
    lines.push('| ID | Name | Active |');
    lines.push('|----|------|--------|');
    for (const c of metadata.components) {
      lines.push(`| ${c.componentId} | ${c.name} | ${c.active} |`);
    }
  }

  return lines.join('\n');
}

/**
 * Builds the custom properties section including list values.
 */
function buildCustomPropertiesSection(metadata: TemplateMetadata): string {
  const lines: string[] = ['# Custom Properties'];

  if (metadata.customProperties.length === 0) {
    lines.push('');
    lines.push('No custom properties are defined for test cases in this project template.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('The following custom properties are defined for test cases:');
  lines.push('');
  lines.push('| Property # | Name | Type | Required | List ID |');
  lines.push('|------------|------|------|----------|---------|');

  for (const cp of metadata.customProperties) {
    lines.push(
      `| ${cp.propertyNumber} | ${cp.name} | ${cp.customPropertyTypeName} | ${cp.isRequired} | ${cp.customListId ?? 'N/A'} |`
    );
  }

  // Include list values for each custom property that has a list
  const listProperties = metadata.customProperties.filter(
    (cp) => cp.customListId !== undefined && cp.customListId !== null
  );

  if (listProperties.length > 0) {
    lines.push('');
    lines.push('## Custom List Values');
    lines.push('');
    lines.push('For custom properties of type List or MultiList, the following values are valid:');

    for (const cp of listProperties) {
      const listValues = metadata.customLists.get(cp.customListId!);
      if (!listValues || listValues.length === 0) continue;

      lines.push('');
      lines.push(`### ${cp.name} (Property #${cp.propertyNumber}, List ID: ${cp.customListId})`);
      lines.push('');
      lines.push('| Value ID | Name | Active |');
      lines.push('|----------|------|--------|');
      for (const lv of listValues) {
        lines.push(`| ${lv.customPropertyValueId} | ${lv.name} | ${lv.active} |`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Builds the source data section with headers and sample rows.
 */
function buildSourceDataSection(sheet: SheetData, sampleRowCount: number): string {
  const lines: string[] = ['# Source Spreadsheet Data'];

  lines.push('');
  lines.push(`Worksheet: "${sheet.name}"`);
  lines.push(`Total rows: ${sheet.rowCount}`);
  lines.push('');

  // Column headers
  lines.push('## Source Column Headers');
  lines.push('');
  for (let i = 0; i < sheet.headers.length; i++) {
    lines.push(`${i + 1}. "${sheet.headers[i]}"`);
  }

  // Sample rows
  const effectiveCount = Math.min(sampleRowCount, sheet.rows.length);
  if (effectiveCount > 0) {
    lines.push('');
    lines.push(`## Sample Data (first ${effectiveCount} rows)`);
    lines.push('');

    const sampleRows = sheet.rows.slice(0, effectiveCount);

    for (let rowIdx = 0; rowIdx < sampleRows.length; rowIdx++) {
      lines.push(`### Row ${rowIdx + 1}`);
      const row = sampleRows[rowIdx];
      for (const header of sheet.headers) {
        const value = row[header];
        const displayValue = formatCellValue(value);
        lines.push(`- ${header}: ${displayValue}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Formats a cell value for display in the prompt.
 */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '(empty)';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    // Truncate very long strings
    if (value.length > 200) {
      return `"${value.substring(0, 200)}..."`;
    }
    return `"${value}"`;
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Builds the output format instructions section.
 */
function buildOutputFormatSection(): string {
  return `# Output Instructions

Produce a structured mapping result with the following structure:

- **fieldMappings**: An array of field mappings, one for each source column that maps to a Spira field. Each mapping has:
  - sourceColumn: The exact source column header name
  - targetField: The Spira field name (e.g., "Name", "Description", "TestCasePriorityId", "OwnerId", "Custom_01" for custom property #1)
  - transformType: One of "direct", "lookup", "template", "ignore"
  - lookupMap: (for "lookup" type) An object mapping source values to Spira IDs/values
  - templatePattern: (for "template" type) A pattern like "{Column A} - {Column B}"

- **testStepMapping**: How test steps are represented in the source data:
  - mode: "inline" (steps in a single cell with delimiter), "separate-rows" (each row is a step), or "none" (no steps)
  - descriptionColumn: Column containing step descriptions
  - expectedResultColumn: Column containing expected results
  - sampleDataColumn: Column containing sample/test data
  - stepDelimiter: Delimiter between steps for inline mode (e.g., "\\n" for newline)

- **folderMapping**: (if a folder/category column exists)
  - sourceColumn: The column containing folder paths or categories
  - pathSeparator: The separator used in paths (e.g., "/" or "\\\\")

- **confidence**: A number 0-1 indicating your confidence in the mapping accuracy
- **unmappedSourceColumns**: Source columns that don't map to any Spira field
- **unmappedTargetFields**: Spira fields that have no source column mapped to them
- **notes**: Any observations about ambiguities or assumptions made

## Important Rules:
1. Every source column must appear either in fieldMappings (with any transformType including "ignore") or in unmappedSourceColumns
2. Use "lookup" when source values are text labels that need to be mapped to Spira IDs (e.g., priority names to priority IDs)
3. Use "direct" when the source value can be used as-is in the target field
4. Use "template" only when multiple source columns need to be combined into one target field
5. For custom properties, use "Custom_XX" as the targetField where XX is the property number (zero-padded, e.g., Custom_01)
6. Match source values to list values case-insensitively when building lookupMaps`;
}
