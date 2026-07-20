/**
 * Pipeline Orchestrator
 *
 * Implements the full import pipeline flow:
 * Phase 1: Authenticate against Spira and fetch template metadata
 * Phase 2: Parse Excel spreadsheet, prompt user for worksheet selection
 * Phase 3: Invoke LLM Mapping Engine with source data and metadata
 * Phase 4: Present mapping result to user for review/modification
 * Phase 5: Transform data using confirmed mapping, run validation
 * Phase 6: Generate and display Mapping Validation Report, require approval
 * Phase 7: Execute import (if approved and not dry-run)
 * Phase 8: Persist log file and display summary report
 *
 * The pipeline is strategy-aware: when an ArtifactStrategy is provided,
 * it delegates artifact-specific behavior (metadata, prompt, validation, import)
 * to the strategy. When no strategy is provided, the built-in test case flow runs.
 */

import { select, input } from '@inquirer/prompts';
import type { ImporterConfig } from './types/config.js';
import type { Logger } from './logger/index.js';
import type { TemplateMetadata } from './types/spira.js';
import type { SheetData } from './parser/index.js';
import type { MappingResult } from './types/mapping.js';
import type { ArtifactStrategy } from './types/strategy.js';
import { createSpiraClient } from './spira/client.js';
import { fetchAllMetadata } from './spira/metadata.js';
import { createExcelParser } from './parser/index.js';
import { createMappingEngine } from './mapping/engine.js';
import { createDataTransformer } from './transformer/index.js';
import { createValidationEngine } from './validator/index.js';
import { generateValidationReport } from './report/index.js';
import { createImportEngine } from './importer/index.js';

/**
 * Pipeline options including the optional strategy.
 */
export interface PipelineOptions {
  /** When provided, drives all artifact-specific behavior in the pipeline. */
  strategy?: ArtifactStrategy;
  /** When provided, skips interactive worksheet selection and uses this sheet name. */
  sheetName?: string;
}

/**
 * Runs the full import pipeline from authentication through to import/dry-run.
 *
 * @param config - Importer configuration (Spira creds, LLM settings, source file, etc.)
 * @param logger - Logger instance
 * @param options - Optional pipeline options including the artifact strategy
 */
export async function runPipeline(
  config: ImporterConfig,
  logger: Logger,
  options?: PipelineOptions,
): Promise<void> {
  const strategy = options?.strategy;

  // Phase 1: Connect & Authenticate
  logger.info('Phase 1: Connecting to Spira...');
  const spiraClient = createSpiraClient(config.spira, logger);
  await spiraClient.authenticate();

  // Phase 2: Retrieve Template Metadata
  logger.info('Phase 2: Retrieving template metadata...');
  const metadataResult = await fetchAllMetadata(spiraClient, config.spira, 0, logger);
  const metadata: TemplateMetadata = metadataResult.metadata;
  if (metadataResult.failures.length > 0) {
    logger.warn(`Some metadata could not be retrieved: ${metadataResult.failures.map(f => f.field).join(', ')}`);
  }
  logger.info(`Retrieved metadata: ${metadata.customProperties.length} custom properties, ` +
    `${metadata.priorities.length} priorities, ${metadata.statuses.length} statuses, ` +
    `${metadata.types.length} types, ${metadata.users.length} users`);

  // Phase 3: Parse Excel Spreadsheet
  logger.info('Phase 3: Parsing source spreadsheet...');
  const parser = createExcelParser();
  const spreadsheet = await parser.parse(config.sourceFile);
  logger.info(`Parsed "${spreadsheet.fileName}": ${spreadsheet.sheets.length} worksheet(s)`);

  // Select worksheet if multiple exist
  let selectedSheet: SheetData;
  if (options?.sheetName) {
    // Sheet name provided via CLI — skip interactive selection
    const match = spreadsheet.sheets.find((s) => s.name === options.sheetName);
    if (!match) {
      const available = spreadsheet.sheets.map((s) => s.name).join(', ');
      throw new Error(`Worksheet "${options.sheetName}" not found. Available: ${available}`);
    }
    selectedSheet = match;
    logger.info(`Using specified worksheet: "${selectedSheet.name}" (${selectedSheet.rowCount} rows)`);
  } else if (spreadsheet.sheets.length === 1) {
    selectedSheet = spreadsheet.sheets[0];
    logger.info(`Using worksheet: "${selectedSheet.name}" (${selectedSheet.rowCount} rows)`);
  } else {
    const sheetChoices = spreadsheet.sheets.map((s) => ({
      name: `${s.name} (${s.rowCount} rows, ${s.headers.length} columns)`,
      value: s.name,
    }));

    const selectedName = await select({
      message: 'Multiple worksheets found. Select the one containing test case data:',
      choices: sheetChoices,
    });

    selectedSheet = spreadsheet.sheets.find((s) => s.name === selectedName)!;
    logger.info(`Selected worksheet: "${selectedSheet.name}" (${selectedSheet.rowCount} rows)`);
  }

  if (selectedSheet.rowCount === 0) {
    logger.error('Selected worksheet has no data rows.');
    process.stderr.write('\n❌ The selected worksheet has no data rows. Nothing to import.\n');
    return;
  }

  // Phase 4: LLM-Assisted Mapping
  logger.info('Phase 4: Generating field mapping via LLM...');
  const mappingEngine = createMappingEngine(config.llm);

  let mappingResult: MappingResult = await mappingEngine.generateMapping(selectedSheet, metadata);
  logger.info(`LLM mapping generated with confidence: ${mappingResult.confidence}`);

  // Phase 5: User Mapping Review
  let mappingApproved = false;
  while (!mappingApproved) {
    displayMappingSummary(mappingResult);

    const reviewChoice = await select({
      message: 'Review the proposed mapping:',
      choices: [
        { name: 'Accept mapping and continue', value: 'accept' },
        { name: 'Provide feedback and regenerate', value: 'feedback' },
        { name: 'Abort import', value: 'abort' },
      ],
    });

    if (reviewChoice === 'accept') {
      mappingApproved = true;
    } else if (reviewChoice === 'feedback') {
      const feedback = await input({
        message: 'Enter your feedback for the LLM (describe what to change):',
      });
      logger.info('Regenerating mapping with user feedback...');
      mappingResult = await mappingEngine.retryMapping(mappingResult, feedback);
      logger.info(`Revised mapping generated with confidence: ${mappingResult.confidence}`);
    } else {
      logger.info('Import aborted by user at mapping review.');
      process.stdout.write('\nImport aborted.\n');
      await logger.persist(config.logFile);
      return;
    }
  }

  // Phase 6: Transform & Validate
  logger.info('Phase 6: Transforming and validating data...');
  const transformer = createDataTransformer();
  let transformResult = transformer.transform(selectedSheet.rows, mappingResult, metadata);
  logger.info(`Transformed ${transformResult.testCases.length} test cases`);

  const validator = createValidationEngine();
  let validationResult = validator.validate(transformResult.testCases, metadata);
  logger.info(`Validation: ${validationResult.stats.validTestCases}/${validationResult.stats.totalTestCases} valid, ` +
    `${validationResult.stats.errorCount} errors, ${validationResult.stats.warningCount} warnings`);

  // Phase 7: Approval Report
  let report = generateValidationReport(transformResult, validationResult, mappingResult);
  process.stdout.write('\n' + report + '\n\n');

  let approved = false;
  while (!approved) {
    const approvalChoice = await select({
      message: validationResult.isValid
        ? 'All data is valid. Proceed with import?'
        : `There are ${validationResult.stats.errorCount} validation errors. Proceed anyway?`,
      choices: [
        { name: config.dryRun ? 'Proceed (dry-run mode)' : 'Proceed with import', value: 'proceed' },
        { name: 'Go back to mapping and revise', value: 'revise' },
        { name: 'Abort import', value: 'abort' },
      ],
    });

    if (approvalChoice === 'proceed') {
      approved = true;
    } else if (approvalChoice === 'revise') {
      logger.info('User requested mapping revision...');
      const feedback = await input({
        message: 'Enter feedback for the LLM to revise the mapping:',
      });
      mappingResult = await mappingEngine.retryMapping(mappingResult, feedback);

      transformResult = transformer.transform(selectedSheet.rows, mappingResult, metadata);
      validationResult = validator.validate(transformResult.testCases, metadata);
      report = generateValidationReport(transformResult, validationResult, mappingResult);
      process.stdout.write('\n' + report + '\n\n');
    } else {
      logger.info('Import aborted by user at approval.');
      process.stdout.write('\nImport aborted.\n');
      await logger.persist(config.logFile);
      return;
    }
  }

  // Phase 8: Import
  if (config.dryRun) {
    logger.info('Dry-run mode: skipping actual import.');
    process.stdout.write('\n🔍 DRY-RUN MODE: No data was sent to Spira.\n');
  }

  logger.info(`Phase 8: ${config.dryRun ? 'Dry-run' : 'Importing'} ${transformResult.testCases.length} test cases...`);

  const importEngine = createImportEngine({
    client: spiraClient,
    logger,
    customPropertyDefinitions: metadata.customProperties,
    existingFolders: metadata.existingFolders,
    pathSeparator: mappingResult.folderMapping?.pathSeparator,
  });

  const importResult = await importEngine.import(transformResult.testCases, {
    dryRun: config.dryRun,
    onProgress: (current, total, item) => {
      process.stdout.write(`\r  [${current}/${total}] ${item}`);
    },
  });

  process.stdout.write('\n\n');

  // Phase 9: Summary & Persist Log
  displayImportSummary(importResult, config.dryRun);
  await logger.persist(config.logFile);
  logger.info(`Log persisted to: ${config.logFile ?? 'import-log-<timestamp>.json'}`);
}

/**
 * Displays the mapping summary to the terminal.
 */
function displayMappingSummary(mapping: MappingResult): void {
  process.stdout.write('\n');
  process.stdout.write('┌─────────────────────────────────────────────────────────────┐\n');
  process.stdout.write('│  Proposed Field Mapping                                     │\n');
  process.stdout.write('├─────────────────────────────────────────────────────────────┤\n');

  for (const fm of mapping.fieldMappings) {
    const arrow = fm.transformType === 'ignore' ? ' ✕ ' : ' → ';
    const line = `│  ${fm.sourceColumn.padEnd(25)}${arrow}${fm.targetField.padEnd(25)} │\n`;
    process.stdout.write(line);
  }

  if (mapping.unmappedSourceColumns.length > 0) {
    process.stdout.write('├─────────────────────────────────────────────────────────────┤\n');
    process.stdout.write(`│  Unmapped: ${mapping.unmappedSourceColumns.join(', ').slice(0, 47)}│\n`);
  }

  if (mapping.notes.length > 0) {
    process.stdout.write('├─────────────────────────────────────────────────────────────┤\n');
    for (const note of mapping.notes.slice(0, 3)) {
      process.stdout.write(`│  ℹ️  ${note.slice(0, 55)}│\n`);
    }
  }

  process.stdout.write(`├─────────────────────────────────────────────────────────────┤\n`);
  process.stdout.write(`│  Confidence: ${(mapping.confidence * 100).toFixed(0)}%                                          │\n`);
  process.stdout.write('└─────────────────────────────────────────────────────────────┘\n');
  process.stdout.write('\n');
}

/**
 * Displays the import result summary to the terminal.
 */
function displayImportSummary(
  result: { totalAttempted: number; successCount: number; failureCount: number; failures: { sourceRowIndex: number; testCaseName: string; error: string; phase: string }[]; createdFolders: string[]; duration: number },
  dryRun: boolean
): void {
  const mode = dryRun ? 'DRY-RUN ' : '';
  process.stdout.write('═══════════════════════════════════════════════════════════════\n');
  process.stdout.write(`  ${mode}Import Summary\n`);
  process.stdout.write('═══════════════════════════════════════════════════════════════\n');
  process.stdout.write(`  Total attempted:  ${result.totalAttempted}\n`);
  process.stdout.write(`  Successful:       ${result.successCount}\n`);
  process.stdout.write(`  Failed:           ${result.failureCount}\n`);
  process.stdout.write(`  Folders created:  ${result.createdFolders.length}\n`);
  process.stdout.write(`  Duration:         ${(result.duration / 1000).toFixed(1)}s\n`);

  if (result.failures.length > 0) {
    process.stdout.write('\n  Failures:\n');
    for (const f of result.failures.slice(0, 10)) {
      process.stdout.write(`    • Row ${f.sourceRowIndex} "${f.testCaseName}": ${f.error}\n`);
    }
    if (result.failures.length > 10) {
      process.stdout.write(`    ... and ${result.failures.length - 10} more (see log file)\n`);
    }
  }

  process.stdout.write('═══════════════════════════════════════════════════════════════\n');
}
