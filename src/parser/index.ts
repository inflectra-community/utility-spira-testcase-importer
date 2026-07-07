/**
 * Excel Parser Module
 *
 * Extracts structured data from customer-provided Excel spreadsheets (.xlsx)
 * while preserving data type fidelity (strings, numbers, booleans, dates).
 *
 * Uses ExcelJS for workbook reading and cell value extraction.
 */

import ExcelJS from 'exceljs';
import * as fs from 'node:fs';
import * as path from 'node:path';

// --- Interfaces ---

export interface ParsedSpreadsheet {
  fileName: string;
  sheets: SheetData[];
}

export interface SheetData {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface ExcelParser {
  parse(filePath: string): Promise<ParsedSpreadsheet>;
  getSampleRows(sheet: SheetData, count: number): Record<string, unknown>[];
}

// --- Error Class ---

export class SpreadsheetParseError extends Error {
  public readonly filePath: string;
  public readonly cause?: unknown;

  constructor(message: string, filePath: string, cause?: unknown) {
    super(message);
    this.name = 'SpreadsheetParseError';
    this.filePath = filePath;
    this.cause = cause;
  }
}

// --- Implementation ---

/**
 * Extracts the resolved cell value from an ExcelJS cell,
 * preserving native types (string, number, boolean, Date).
 * For formula cells, returns the computed result.
 * For rich text cells, concatenates the text fragments.
 */
function resolveCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;

  if (value === null || value === undefined) {
    return null;
  }

  // Formula cells: use the result value
  if (typeof value === 'object' && 'formula' in value) {
    const formulaValue = value as ExcelJS.CellFormulaValue;
    const result = formulaValue.result;
    if (result === undefined || result === null) {
      return null;
    }
    // Result could itself be a rich text object
    if (typeof result === 'object' && 'richText' in result) {
      return (result as ExcelJS.CellRichTextValue).richText
        .map((rt) => rt.text)
        .join('');
    }
    return result;
  }

  // Shared formula cells
  if (typeof value === 'object' && 'sharedFormula' in value) {
    const sharedValue = value as ExcelJS.CellSharedFormulaValue;
    const result = sharedValue.result;
    if (result === undefined || result === null) {
      return null;
    }
    if (typeof result === 'object' && 'richText' in result) {
      return (result as ExcelJS.CellRichTextValue).richText
        .map((rt) => rt.text)
        .join('');
    }
    return result;
  }

  // Rich text cells: concatenate text parts
  if (typeof value === 'object' && 'richText' in value) {
    return (value as ExcelJS.CellRichTextValue).richText
      .map((rt) => rt.text)
      .join('');
  }

  // Error cells
  if (typeof value === 'object' && 'error' in value) {
    return null;
  }

  // Date objects — pass through as Date
  if (value instanceof Date) {
    return value;
  }

  // Primitives: string, number, boolean
  return value;
}

/**
 * Parses a single worksheet into a SheetData structure.
 * The first row is treated as headers; subsequent rows are mapped as records.
 */
function parseWorksheet(worksheet: ExcelJS.Worksheet): SheetData {
  const headers: string[] = [];
  const rows: Record<string, unknown>[] = [];

  const headerRow = worksheet.getRow(1);

  // Extract headers from the first row
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const headerValue = resolveCellValue(cell);
    const headerStr = headerValue !== null && headerValue !== undefined
      ? String(headerValue).trim()
      : '';
    // Store at the column index position to handle sparse columns
    headers[colNumber - 1] = headerStr;
  });

  // If no headers found, return empty sheet data
  if (headers.length === 0 || headers.every((h) => !h)) {
    return {
      name: worksheet.name,
      headers: [],
      rows: [],
      rowCount: 0,
    };
  }

  // Clean up sparse header array — fill gaps with empty strings
  const cleanHeaders = Array.from({ length: headers.length }, (_, i) => headers[i] || '');

  // Filter to only non-empty headers for the final output
  const validHeaders = cleanHeaders.filter((h) => h.length > 0);

  // Parse data rows (row 2 onwards)
  const rowCount = worksheet.rowCount;
  for (let rowIdx = 2; rowIdx <= rowCount; rowIdx++) {
    const row = worksheet.getRow(rowIdx);
    const record: Record<string, unknown> = {};
    let hasValue = false;

    for (let colIdx = 0; colIdx < cleanHeaders.length; colIdx++) {
      const header = cleanHeaders[colIdx];
      if (!header) continue; // Skip columns without headers

      const cell = row.getCell(colIdx + 1);
      const value = resolveCellValue(cell);
      record[header] = value;
      if (value !== null) {
        hasValue = true;
      }
    }

    // Only include rows that have at least one non-null value
    if (hasValue) {
      rows.push(record);
    }
  }

  return {
    name: worksheet.name,
    headers: validHeaders,
    rows,
    rowCount: rows.length,
  };
}

/**
 * Creates an ExcelParser instance that can parse .xlsx files
 * and extract sample rows for LLM prompts.
 */
export function createExcelParser(): ExcelParser {
  return {
    async parse(filePath: string): Promise<ParsedSpreadsheet> {
      // Validate file exists
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        throw new SpreadsheetParseError(
          `File not found: ${resolvedPath}`,
          resolvedPath,
        );
      }

      // Validate file extension
      const ext = path.extname(resolvedPath).toLowerCase();
      if (ext !== '.xlsx' && ext !== '.xls') {
        throw new SpreadsheetParseError(
          `Unsupported file format "${ext}". Only .xlsx files are fully supported. ` +
          `.xls files may work but are not guaranteed.`,
          resolvedPath,
        );
      }

      try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(resolvedPath);

        const sheets: SheetData[] = [];

        workbook.eachSheet((worksheet) => {
          const sheetData = parseWorksheet(worksheet);
          sheets.push(sheetData);
        });

        if (sheets.length === 0) {
          throw new SpreadsheetParseError(
            'No worksheets found in the workbook.',
            resolvedPath,
          );
        }

        return {
          fileName: path.basename(resolvedPath),
          sheets,
        };
      } catch (error) {
        // Re-throw SpreadsheetParseError as-is
        if (error instanceof SpreadsheetParseError) {
          throw error;
        }

        // Wrap other errors
        const message = error instanceof Error
          ? error.message
          : 'Unknown error occurred';
        throw new SpreadsheetParseError(
          `Failed to parse spreadsheet: ${message}`,
          resolvedPath,
          error,
        );
      }
    },

    getSampleRows(sheet: SheetData, count: number): Record<string, unknown>[] {
      if (count <= 0) return [];
      return sheet.rows.slice(0, count);
    },
  };
}
