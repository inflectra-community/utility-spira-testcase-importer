/**
 * Unit tests for the Excel Parser module.
 *
 * Tests cover:
 * - Parsing a simple xlsx file (fixture created programmatically with ExcelJS)
 * - Data type preservation (strings, numbers, booleans, dates)
 * - getSampleRows returning correct count
 * - Error handling for missing files
 * - Multiple worksheets
 * - Empty worksheets
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createExcelParser, SpreadsheetParseError } from './index.js';
import type { SheetData } from './index.js';

// Temp directory for test fixtures
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Helper: creates a test xlsx file with given sheets data.
 */
async function createTestWorkbook(
  fileName: string,
  sheets: Array<{
    name: string;
    headers: string[];
    rows: unknown[][];
  }>,
): Promise<string> {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.addRow(sheet.headers);
    for (const row of sheet.rows) {
      ws.addRow(row);
    }
  }

  const filePath = path.join(tmpDir, fileName);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

describe('ExcelParser', () => {
  const parser = createExcelParser();

  describe('parse', () => {
    it('should parse a simple xlsx file with string data', async () => {
      const filePath = await createTestWorkbook('simple.xlsx', [
        {
          name: 'TestCases',
          headers: ['Name', 'Description', 'Priority'],
          rows: [
            ['Login Test', 'Verify login functionality', 'High'],
            ['Logout Test', 'Verify logout functionality', 'Medium'],
          ],
        },
      ]);

      const result = await parser.parse(filePath);

      expect(result.fileName).toBe('simple.xlsx');
      expect(result.sheets).toHaveLength(1);
      expect(result.sheets[0].name).toBe('TestCases');
      expect(result.sheets[0].headers).toEqual(['Name', 'Description', 'Priority']);
      expect(result.sheets[0].rowCount).toBe(2);
      expect(result.sheets[0].rows[0]).toEqual({
        Name: 'Login Test',
        Description: 'Verify login functionality',
        Priority: 'High',
      });
      expect(result.sheets[0].rows[1]).toEqual({
        Name: 'Logout Test',
        Description: 'Verify logout functionality',
        Priority: 'Medium',
      });
    });

    it('should preserve data types: numbers, booleans, dates', async () => {
      const testDate = new Date(2024, 5, 15); // June 15, 2024
      const filePath = await createTestWorkbook('types.xlsx', [
        {
          name: 'Data',
          headers: ['Text', 'Number', 'Boolean', 'Date'],
          rows: [
            ['hello', 42, true, testDate],
            ['world', 3.14, false, new Date(2024, 0, 1)],
          ],
        },
      ]);

      const result = await parser.parse(filePath);
      const rows = result.sheets[0].rows;

      // String preservation
      expect(rows[0]['Text']).toBe('hello');
      expect(typeof rows[0]['Text']).toBe('string');

      // Number preservation
      expect(rows[0]['Number']).toBe(42);
      expect(typeof rows[0]['Number']).toBe('number');
      expect(rows[1]['Number']).toBe(3.14);

      // Boolean preservation
      expect(rows[0]['Boolean']).toBe(true);
      expect(typeof rows[0]['Boolean']).toBe('boolean');
      expect(rows[1]['Boolean']).toBe(false);

      // Date preservation
      expect(rows[0]['Date']).toBeInstanceOf(Date);
      expect((rows[0]['Date'] as Date).getFullYear()).toBe(2024);
    });

    it('should handle multiple worksheets', async () => {
      const filePath = await createTestWorkbook('multi.xlsx', [
        {
          name: 'Sheet1',
          headers: ['A', 'B'],
          rows: [['a1', 'b1']],
        },
        {
          name: 'Sheet2',
          headers: ['X', 'Y', 'Z'],
          rows: [
            ['x1', 'y1', 'z1'],
            ['x2', 'y2', 'z2'],
          ],
        },
      ]);

      const result = await parser.parse(filePath);

      expect(result.sheets).toHaveLength(2);
      expect(result.sheets[0].name).toBe('Sheet1');
      expect(result.sheets[0].headers).toEqual(['A', 'B']);
      expect(result.sheets[0].rowCount).toBe(1);
      expect(result.sheets[1].name).toBe('Sheet2');
      expect(result.sheets[1].headers).toEqual(['X', 'Y', 'Z']);
      expect(result.sheets[1].rowCount).toBe(2);
    });

    it('should handle empty worksheets (headers only, no data rows)', async () => {
      const filePath = await createTestWorkbook('empty-rows.xlsx', [
        {
          name: 'Empty',
          headers: ['Col1', 'Col2'],
          rows: [],
        },
      ]);

      const result = await parser.parse(filePath);

      expect(result.sheets[0].headers).toEqual(['Col1', 'Col2']);
      expect(result.sheets[0].rows).toEqual([]);
      expect(result.sheets[0].rowCount).toBe(0);
    });

    it('should handle worksheets with no headers', async () => {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet('NoHeaders');
      const filePath = path.join(tmpDir, 'no-headers.xlsx');
      await workbook.xlsx.writeFile(filePath);

      const result = await parser.parse(filePath);

      expect(result.sheets[0].headers).toEqual([]);
      expect(result.sheets[0].rows).toEqual([]);
      expect(result.sheets[0].rowCount).toBe(0);
    });

    it('should throw SpreadsheetParseError for missing files', async () => {
      const missingPath = path.join(tmpDir, 'nonexistent.xlsx');

      await expect(parser.parse(missingPath)).rejects.toThrow(SpreadsheetParseError);
      await expect(parser.parse(missingPath)).rejects.toThrow(/File not found/);
    });

    it('should throw SpreadsheetParseError for unsupported file extensions', async () => {
      const csvPath = path.join(tmpDir, 'data.csv');
      fs.writeFileSync(csvPath, 'a,b,c\n1,2,3');

      await expect(parser.parse(csvPath)).rejects.toThrow(SpreadsheetParseError);
      await expect(parser.parse(csvPath)).rejects.toThrow(/Unsupported file format/);
    });

    it('should throw SpreadsheetParseError for corrupt files', async () => {
      const corruptPath = path.join(tmpDir, 'corrupt.xlsx');
      fs.writeFileSync(corruptPath, 'not a real xlsx file content');

      await expect(parser.parse(corruptPath)).rejects.toThrow(SpreadsheetParseError);
      await expect(parser.parse(corruptPath)).rejects.toThrow(/Failed to parse spreadsheet/);
    });

    it('should skip entirely empty rows (all null values)', async () => {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Sparse');
      ws.addRow(['Name', 'Value']);
      ws.addRow(['first', 100]);
      ws.addRow([null, null]); // Empty row
      ws.addRow(['third', 300]);

      const filePath = path.join(tmpDir, 'sparse.xlsx');
      await workbook.xlsx.writeFile(filePath);

      const result = await parser.parse(filePath);

      expect(result.sheets[0].rowCount).toBe(2);
      expect(result.sheets[0].rows[0]['Name']).toBe('first');
      expect(result.sheets[0].rows[1]['Name']).toBe('third');
    });
  });

  describe('getSampleRows', () => {
    it('should return the first N rows', async () => {
      const filePath = await createTestWorkbook('sample.xlsx', [
        {
          name: 'Data',
          headers: ['ID', 'Name'],
          rows: [
            [1, 'Alpha'],
            [2, 'Beta'],
            [3, 'Gamma'],
            [4, 'Delta'],
            [5, 'Epsilon'],
          ],
        },
      ]);

      const result = await parser.parse(filePath);
      const samples = parser.getSampleRows(result.sheets[0], 3);

      expect(samples).toHaveLength(3);
      expect(samples[0]['Name']).toBe('Alpha');
      expect(samples[1]['Name']).toBe('Beta');
      expect(samples[2]['Name']).toBe('Gamma');
    });

    it('should return all rows when count exceeds available', async () => {
      const filePath = await createTestWorkbook('few.xlsx', [
        {
          name: 'Data',
          headers: ['X'],
          rows: [['a'], ['b']],
        },
      ]);

      const result = await parser.parse(filePath);
      const samples = parser.getSampleRows(result.sheets[0], 10);

      expect(samples).toHaveLength(2);
    });

    it('should return empty array for count of 0', () => {
      const sheet: SheetData = {
        name: 'Test',
        headers: ['A'],
        rows: [{ A: 1 }, { A: 2 }],
        rowCount: 2,
      };

      expect(parser.getSampleRows(sheet, 0)).toEqual([]);
    });

    it('should return empty array for negative count', () => {
      const sheet: SheetData = {
        name: 'Test',
        headers: ['A'],
        rows: [{ A: 1 }],
        rowCount: 1,
      };

      expect(parser.getSampleRows(sheet, -1)).toEqual([]);
    });
  });
});
