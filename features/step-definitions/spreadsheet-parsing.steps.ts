/**
 * Step definitions for spreadsheet-parsing.feature
 *
 * Uses the real ExcelParser against in-memory fixture workbooks
 * created with ExcelJS during test setup.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LogicWorld } from '../support/worlds/logic.world.js';
import { createExcelParser, type ParsedSpreadsheet, type ExcelParser } from '../../src/parser/index.js';
import ExcelJS from 'exceljs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// --- State scoped to spreadsheet-parsing scenarios ---

interface ParserState {
  parser: ExcelParser;
  filePath: string | null;
  result: ParsedSpreadsheet | null;
  error: Error | null;
  tempDir: string;
}

function getParserState(world: LogicWorld): ParserState {
  if (!(world as any).__parserState) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spira-parser-test-'));
    (world as any).__parserState = {
      parser: createExcelParser(),
      filePath: null,
      result: null,
      error: null,
      tempDir,
    } as ParserState;
  }
  return (world as any).__parserState;
}

/**
 * Helper: creates a .xlsx file from the given data and returns its path.
 */
async function createFixtureXlsx(
  tempDir: string,
  fileName: string,
  sheets: { name: string; headers: string[]; rows: unknown[][] }[],
): Promise<string> {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.addRow(sheet.headers);
    for (const row of sheet.rows) {
      ws.addRow(row);
    }
  }

  const filePath = path.join(tempDir, fileName);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

// --- Given steps ---

Given('an Excel file with defined column headers and data rows', async function (this: LogicWorld) {
  const state = getParserState(this);
  state.filePath = await createFixtureXlsx(state.tempDir, 'basic.xlsx', [{
    name: 'Tests',
    headers: ['Test Name', 'Priority', 'Description'],
    rows: [
      ['Login test', 'High', 'Verify login works'],
      ['Logout test', 'Low', 'Verify logout works'],
      ['Search test', 'Medium', 'Verify search returns results'],
    ],
  }]);
});

Given('an Excel file containing multiple worksheets', async function (this: LogicWorld) {
  const state = getParserState(this);
  state.filePath = await createFixtureXlsx(state.tempDir, 'multi-sheet.xlsx', [
    {
      name: 'Functional Tests',
      headers: ['Name', 'Steps'],
      rows: [['Login', 'Step 1\nStep 2']],
    },
    {
      name: 'Performance Tests',
      headers: ['Name', 'Response Time'],
      rows: [['API Load', '200ms']],
    },
    {
      name: 'Metadata',
      headers: ['Key', 'Value'],
      rows: [['Version', '1.0']],
    },
  ]);
});

Given('an Excel file with columns containing strings, numbers, booleans, and dates', async function (this: LogicWorld) {
  const state = getParserState(this);

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('TypedData');
  ws.addRow(['StringCol', 'NumberCol', 'BoolCol', 'DateCol']);
  ws.addRow(['hello', 42, true, new Date('2024-03-15T10:30:00Z')]);
  ws.addRow(['world', 3.14, false, new Date('2025-01-01T00:00:00Z')]);

  const filePath = path.join(state.tempDir, 'typed.xlsx');
  await workbook.xlsx.writeFile(filePath);
  state.filePath = filePath;
});

Given('a file path pointing to a corrupted or invalid Excel file', async function (this: LogicWorld) {
  const state = getParserState(this);
  const filePath = path.join(state.tempDir, 'corrupted.xlsx');
  fs.writeFileSync(filePath, 'this is not a valid xlsx file content!!!', 'utf-8');
  state.filePath = filePath;
});

Given('a file path pointing to a non-existent file', function (this: LogicWorld) {
  const state = getParserState(this);
  state.filePath = path.join(state.tempDir, 'does_not_exist.xlsx');
});

Given('an Excel file with a worksheet containing only headers and no data rows', async function (this: LogicWorld) {
  const state = getParserState(this);
  state.filePath = await createFixtureXlsx(state.tempDir, 'headers-only.xlsx', [{
    name: 'Empty',
    headers: ['Name', 'Priority', 'Status'],
    rows: [],
  }]);
});

// --- When steps ---

When('I parse the spreadsheet', async function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.filePath, 'File path should be set');
  try {
    state.result = await state.parser.parse(state.filePath);
  } catch (err) {
    state.error = err instanceof Error ? err : new Error(String(err));
  }
});

When('I attempt to parse the spreadsheet', async function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.filePath, 'File path should be set');
  try {
    state.result = await state.parser.parse(state.filePath);
  } catch (err) {
    state.error = err instanceof Error ? err : new Error(String(err));
  }
});

// --- Then steps ---

Then('the parser should extract all data rows', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.result, 'Parse result should exist');
  const sheet = state.result.sheets[0];
  assert.ok(sheet.rows.length > 0, 'Should have extracted data rows');
  assert.strictEqual(sheet.rowCount, 3);
});

Then('all column headers should be preserved', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.result, 'Parse result should exist');
  const sheet = state.result.sheets[0];
  assert.deepStrictEqual(sheet.headers, ['Test Name', 'Priority', 'Description']);
});

Then('each row should be accessible by its column header', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.result, 'Parse result should exist');
  const sheet = state.result.sheets[0];
  const firstRow = sheet.rows[0];
  assert.strictEqual(firstRow['Test Name'], 'Login test');
  assert.strictEqual(firstRow['Priority'], 'High');
  assert.strictEqual(firstRow['Description'], 'Verify login works');
});

Then('the Importer should present all worksheets for selection', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.result, 'Parse result should exist');
  assert.ok(state.result.sheets.length > 1, 'Should have multiple sheets');
  assert.strictEqual(state.result.sheets.length, 3);
});

Then('the user should be able to select which worksheet contains test case data', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.result, 'Parse result should exist');
  // Verify each sheet has a name that can be used for selection
  for (const sheet of state.result.sheets) {
    assert.ok(sheet.name.length > 0, 'Each sheet should have a name');
  }
});

Then('string values should remain as strings', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.result, 'Parse result should exist');
  const row = state.result.sheets[0].rows[0];
  assert.strictEqual(typeof row['StringCol'], 'string');
  assert.strictEqual(row['StringCol'], 'hello');
});

Then('numeric values should remain as numbers', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.result, 'Parse result should exist');
  const row = state.result.sheets[0].rows[0];
  assert.strictEqual(typeof row['NumberCol'], 'number');
  assert.strictEqual(row['NumberCol'], 42);
});

Then('boolean values should remain as booleans', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.result, 'Parse result should exist');
  const row = state.result.sheets[0].rows[0];
  assert.strictEqual(typeof row['BoolCol'], 'boolean');
  assert.strictEqual(row['BoolCol'], true);
});

Then('date values should be preserved as dates', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.result, 'Parse result should exist');
  const row = state.result.sheets[0].rows[0];
  assert.ok(row['DateCol'] instanceof Date, 'Date should be a Date object');
});

Then('I should receive a descriptive error indicating the file issue', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.error, 'Should have an error');
  assert.ok(state.error.message.length > 0, 'Error should have a message');
});

Then('the error should include the file path', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.error, 'Should have an error');
  // SpreadsheetParseError has filePath property
  const errWithPath = state.error as any;
  assert.ok(
    errWithPath.filePath || state.error.message.includes(state.filePath!.split(path.sep).pop()!),
    'Error should reference the file path',
  );
});

Then('I should receive a descriptive error indicating the file does not exist', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.error, 'Should have an error');
  assert.ok(
    state.error.message.toLowerCase().includes('not found') || state.error.message.toLowerCase().includes('does not exist') || state.error.message.toLowerCase().includes('file not found'),
    `Error should indicate file not found. Got: "${state.error.message}"`,
  );
});

Then('the parser should report zero data rows', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.result, 'Parse result should exist');
  const sheet = state.result.sheets[0];
  assert.strictEqual(sheet.rowCount, 0);
  assert.strictEqual(sheet.rows.length, 0);
});

Then('the column headers should still be extracted', function (this: LogicWorld) {
  const state = getParserState(this);
  assert.ok(state.result, 'Parse result should exist');
  const sheet = state.result.sheets[0];
  assert.ok(sheet.headers.length > 0, 'Headers should still be present');
  assert.deepStrictEqual(sheet.headers, ['Name', 'Priority', 'Status']);
});
