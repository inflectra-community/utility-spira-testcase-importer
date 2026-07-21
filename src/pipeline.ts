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
import type { MappingResult, FieldMapping } from './types/mapping.js';
import type { ArtifactStrategy } from './types/strategy.js';
import { createSpiraClient } from './spira/client.js';
import { fetchAllMetadata } from './spira/metadata.js';
import { createExcelParser } from './parser/index.js';
import { createMappingEngine } from './mapping/engine.js';
import { createDataTransformer } from './transformer/index.js';
import { createValidationEngine } from './validator/index.js';
import { generateValidationReport } from './report/index.js';
import { createImportEngine } from './importer/index.js';
import { analyzeSpreadsheet, type PreAnalysisResult } from './heuristics/index.js';

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

  // Display configuration banner
  const DIM = '\x1b[2m';
  const BOLD = '\x1b[1m';
  const CYAN = '\x1b[36m';
  const RESET = '\x1b[0m';
  process.stdout.write(`\n${CYAN}${BOLD}─── Spira Import Configuration ───${RESET}\n`);
  process.stdout.write(`  ${BOLD}Spira URL:${RESET}     ${config.spira.baseUrl}\n`);
  process.stdout.write(`  ${BOLD}Project ID:${RESET}    ${config.spira.projectId}\n`);
  process.stdout.write(`  ${BOLD}Username:${RESET}      ${config.spira.username}\n`);
  process.stdout.write(`  ${BOLD}API Key:${RESET}       ${DIM}(hidden)${RESET}\n`);
  process.stdout.write(`  ${BOLD}LLM Provider:${RESET}  ${config.llm.provider}\n`);
  process.stdout.write(`  ${BOLD}LLM Model:${RESET}     ${config.llm.model}\n`);
  if (config.llm.region) {
    process.stdout.write(`  ${BOLD}AWS Region:${RESET}    ${config.llm.region}\n`);
  }
  process.stdout.write(`  ${BOLD}Source File:${RESET}   ${config.sourceFile}\n`);
  process.stdout.write(`  ${BOLD}Dry Run:${RESET}       ${config.dryRun ? 'Yes' : 'No'}\n`);
  process.stdout.write(`${CYAN}${'─'.repeat(35)}${RESET}\n\n`);

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

  // Phase 3.5: Heuristic Pre-Analysis
  logger.info('Phase 3.5: Running heuristic pre-analysis...');
  let preAnalysis;
  try {
    preAnalysis = analyzeSpreadsheet(selectedSheet, {
    fieldDefinitions: strategy?.getFieldDefinitions() ?? [
      { name: 'Name', label: 'Name', type: 'string', required: true, description: 'Test case name' },
      { name: 'Description', label: 'Description', type: 'string', required: false, description: 'Description' },
      { name: 'TestCasePriorityId', label: 'Priority', type: 'integer', required: false, description: 'Priority ID' },
      { name: 'TestCaseStatusId', label: 'Status', type: 'integer', required: false, description: 'Status ID' },
      { name: 'TestCaseTypeId', label: 'Type', type: 'integer', required: false, description: 'Type ID' },
      { name: 'OwnerId', label: 'Owner', type: 'integer', required: false, description: 'Owner user ID' },
      { name: 'ComponentIds', label: 'Components', type: 'integer[]', required: false, description: 'Component IDs' },
      { name: 'Tags', label: 'Tags', type: 'string', required: false, description: 'Tags' },
    ],
    metadata: {
      projectId: metadata.projectId,
      templateId: metadata.templateId,
      customProperties: metadata.customProperties,
      customLists: metadata.customLists,
      users: metadata.users,
      components: metadata.components,
      lookups: [
        { fieldName: 'TestCasePriorityId', label: 'Priorities', entries: metadata.priorities.map(p => ({ id: p.priorityId, name: p.name, active: p.active })) },
        { fieldName: 'TestCaseStatusId', label: 'Statuses', entries: metadata.statuses.map(s => ({ id: s.testCaseStatusId, name: s.name, active: s.active })) },
        { fieldName: 'TestCaseTypeId', label: 'Types', entries: metadata.types.map(t => ({ id: t.testCaseTypeId, name: t.name, active: t.active })) },
      ],
      existingFolders: (metadata.existingFolders ?? []).map(f => ({ id: f.testCaseFolderId, name: f.name, parentId: f.parentTestCaseFolderId, indentLevel: f.indentLevel })),
    },
  });
  } catch (heuristicError) {
    const msg = heuristicError instanceof Error ? heuristicError.stack ?? heuristicError.message : String(heuristicError);
    logger.warn(`Heuristic pre-analysis failed (falling back to full LLM): ${msg}`);
    preAnalysis = { fullyResolved: false, resolvedMappings: [], valueLookups: new Map(), structure: { stepStructure: { mode: 'none' as const, confidence: 0 }, folderStructure: { detected: false, confidence: 0 } }, unresolvedColumns: selectedSheet.headers, unresolvedValues: [], summary: '  Heuristic analysis failed - using full LLM mode.' };
  }
  process.stdout.write('\n' + preAnalysis.summary + '\n\n');

  // Phase 4: LLM-Assisted Mapping (or skip if heuristics fully resolved)
  let mappingResult: MappingResult;

  if (preAnalysis.fullyResolved) {
    logger.info('Heuristics fully resolved the mapping - skipping LLM call.');
    mappingResult = convertPreAnalysisToMapping(preAnalysis);
  } else {
    logger.info(`Phase 4: Generating field mapping via LLM (${preAnalysis.unresolvedColumns.length} columns need LLM)...`);
    const mappingEngine = createMappingEngine(config.llm);

    // Build context so LLM knows what's already resolved
    const contextLines: string[] = [
      '# Pre-Analysis Context (already resolved — do NOT re-map these)',
      '',
      'The following columns have been matched deterministically:',
    ];
    for (const m of preAnalysis.resolvedMappings) {
      contextLines.push(`- "${m.sourceColumn}" -> ${m.targetField} (${m.matchReason}, confidence ${(m.confidence * 100).toFixed(0)}%)`);
    }
    if (preAnalysis.structure.stepStructure.mode !== 'none') {
      contextLines.push('', `Step structure detected: ${preAnalysis.structure.stepStructure.mode} mode`);
      if (preAnalysis.structure.stepStructure.stepDescriptionColumn) {
        contextLines.push(`- Step description column: "${preAnalysis.structure.stepStructure.stepDescriptionColumn}"`);
      }
      if (preAnalysis.structure.stepStructure.stepExpectedResultColumn) {
        contextLines.push(`- Step expected result column: "${preAnalysis.structure.stepStructure.stepExpectedResultColumn}"`);
      }
    }
    if (preAnalysis.structure.folderStructure.detected) {
      contextLines.push('', `Folder column detected: "${preAnalysis.structure.folderStructure.column}" (separator: "${preAnalysis.structure.folderStructure.separator}")`);
    }
    contextLines.push('', '## Your task: map ONLY these remaining columns:', '');
    for (const col of preAnalysis.unresolvedColumns) {
      contextLines.push(`- "${col}"`);
    }
    contextLines.push('');
    contextLines.push('## Available custom properties you can map to:');
    const cpNames = metadata.customProperties.map(cp => cp.name).filter(Boolean);
    if (cpNames.length > 0) {
      for (const name of cpNames) {
        contextLines.push(`- "${name}"`);
      }
    } else {
      contextLines.push('- (none defined)');
    }
    contextLines.push('');
    contextLines.push('## Rules:');
    contextLines.push('- For columns already resolved above, include them in your output with the SAME targetField and transformType.');
    contextLines.push('- For unresolved columns: map to a standard Spira field, a custom property name from the list above, or set transformType to "ignore".');
    contextLines.push('- If a column does NOT clearly map to any known field or custom property, set transformType to "ignore". Do NOT invent target fields.');
    contextLines.push('- Use the exact custom property name as targetField (e.g., "Source Test ID", "Transaction Code").');
    contextLines.push('- IMPORTANT: This is an import from an external system into Spira. The source data has its own ID space (e.g., "TC-7", "REQ-123"). These are NOT Spira IDs. Columns named "Id", "ID", "Test ID", "TC_ID" etc. are historical source identifiers. If a text-type custom property exists for storing source references (e.g., "Source Test ID"), map the ID column there. Otherwise ignore it.');
    contextLines.push('- Columns containing file paths, screenshots, or attachment references cannot be imported via the API. Mark them as "ignore".');

    const preAnalysisContextStr = contextLines.join('\n');

    // TODO: Token optimisation — when unresolved columns are few (<= 3), consider a slim prompt
    // that omits the full buildMappingPrompt and sends only the context + schema instructions.
    // Current cost: ~3K tokens per LLM call (acceptable for single imports).
    // Future considerations:
    //   - Per-model token budgets (Nova Lite is cheap, Claude Sonnet is 60x more expensive)
    //   - Batch import scenarios (multiple files) would benefit from slim prompts
    //   - Track token usage per session for cost visibility
    //   - The slim prompt (631 tokens) works conceptually but Nova Lite can't parse the response
    //     without full schema guidance — stronger models may handle it fine.
    logger.info(`LLM context: ${preAnalysisContextStr.length} chars (~${Math.ceil(preAnalysisContextStr.length / 4)} tokens). Full prompt appended.`);
    mappingResult = await mappingEngine.generateMapping(selectedSheet, metadata, 5, preAnalysisContextStr);
    // Merge heuristic value lookups into the LLM result
    mergeLookupMaps(mappingResult, preAnalysis);

    // Override LLM field mappings for columns the heuristics already resolved
    // The LLM was told to preserve them but may not have — force the heuristic answers.
    const heuristicResolved = new Map(preAnalysis.resolvedMappings.map(m => [m.sourceColumn, m]));
    for (let i = 0; i < mappingResult.fieldMappings.length; i++) {
      const fm = mappingResult.fieldMappings[i];
      const heuristic = heuristicResolved.get(fm.sourceColumn);
      if (heuristic) {
        const lookupMap = preAnalysis.valueLookups.get(heuristic.targetField);
        mappingResult.fieldMappings[i] = {
          sourceColumn: fm.sourceColumn,
          targetField: heuristic.targetField,
          transformType: heuristic.targetField === '__Ignore__' ? 'ignore' : (lookupMap ? 'lookup' : 'direct'),
          lookupMap,
        };
      }
    }
    // Also remove step columns from fieldMappings — they're handled by testStepMapping
    const stepColumns = new Set<string>();
    if (preAnalysis.structure.stepStructure.stepNumberColumn) stepColumns.add(preAnalysis.structure.stepStructure.stepNumberColumn);
    if (preAnalysis.structure.stepStructure.stepDescriptionColumn) stepColumns.add(preAnalysis.structure.stepStructure.stepDescriptionColumn);
    if (preAnalysis.structure.stepStructure.stepExpectedResultColumn) stepColumns.add(preAnalysis.structure.stepStructure.stepExpectedResultColumn);
    if (stepColumns.size > 0) {
      mappingResult.fieldMappings = mappingResult.fieldMappings.filter(fm => !stepColumns.has(fm.sourceColumn));
    }
    // Ensure folder column is handled via folderMapping, not fieldMappings
    if (preAnalysis.structure.folderStructure.detected && preAnalysis.structure.folderStructure.column) {
      const folderCol = preAnalysis.structure.folderStructure.column;
      mappingResult.fieldMappings = mappingResult.fieldMappings.filter(fm => fm.sourceColumn !== folderCol);
    }
    // Ensure heuristic structure detection is preserved (LLM may not return step/folder config)
    if (preAnalysis.structure.stepStructure.mode !== 'none') {
      const step = preAnalysis.structure.stepStructure;
      mappingResult.testStepMapping = {
        mode: step.mode,
        descriptionColumn: step.mode === 'separate-rows' ? step.stepDescriptionColumn : step.inlineColumn,
        expectedResultColumn: step.stepExpectedResultColumn,
        groupingColumn: step.groupingColumn,
        stepDelimiter: step.mode === 'inline' ? (step.inlineDelimiter === 'semicolon' ? ';' : '\n') : undefined,
      };
    }
    if (preAnalysis.structure.folderStructure.detected) {
      mappingResult.folderMapping = {
        sourceColumn: preAnalysis.structure.folderStructure.column!,
        pathSeparator: preAnalysis.structure.folderStructure.separator ?? '/',
      };
    }
    logger.info(`LLM mapping generated with confidence: ${mappingResult.confidence}`);
  }

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
      const mappingEngine = createMappingEngine(config.llm);
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
      const revisionEngine = createMappingEngine(config.llm);
      mappingResult = await revisionEngine.retryMapping(mappingResult, feedback);

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
  const GREEN = '\x1b[32m';
  const YELLOW = '\x1b[33m';
  const RED = '\x1b[31m';
  const DIM = '\x1b[2m';
  const BOLD = '\x1b[1m';
  const RESET = '\x1b[0m';
  const CYAN = '\x1b[36m';

  process.stdout.write('\n');
  process.stdout.write(`${CYAN}${BOLD}┌─────────────────────────────────────────────────────────────┐${RESET}\n`);
  process.stdout.write(`${CYAN}${BOLD}│  Proposed Field Mapping                                     │${RESET}\n`);
  process.stdout.write(`${CYAN}├─────────────────────────────────────────────────────────────┤${RESET}\n`);

  for (const fm of mapping.fieldMappings) {
    if (fm.transformType === 'ignore') {
      process.stdout.write(`${DIM}│  ${fm.sourceColumn.padEnd(25)} x  ignore${' '.repeat(20)}│${RESET}\n`);
    } else {
      const colour = fm.transformType === 'lookup' ? YELLOW : GREEN;
      const typeHint = fm.transformType === 'lookup' ? ` ${DIM}(lookup)${RESET}` : '';
      process.stdout.write(`│  ${fm.sourceColumn.padEnd(25)}${colour}->${RESET} ${fm.targetField}${typeHint}\n`);
    }
  }

  if (mapping.unmappedSourceColumns.length > 0) {
    process.stdout.write(`${CYAN}├─────────────────────────────────────────────────────────────┤${RESET}\n`);
    process.stdout.write(`│  ${RED}Unmapped:${RESET} ${mapping.unmappedSourceColumns.join(', ').slice(0, 47)}│\n`);
  }

  if (mapping.notes.length > 0) {
    process.stdout.write(`${CYAN}├─────────────────────────────────────────────────────────────┤${RESET}\n`);
    for (const note of mapping.notes.slice(0, 3)) {
      process.stdout.write(`│  ${DIM}${note.slice(0, 57)}${RESET}│\n`);
    }
  }

  // Confidence with colour
  const confPct = (mapping.confidence * 100).toFixed(0);
  const confColour = mapping.confidence >= 0.85 ? GREEN : mapping.confidence >= 0.6 ? YELLOW : RED;
  process.stdout.write(`${CYAN}├─────────────────────────────────────────────────────────────┤${RESET}\n`);
  process.stdout.write(`│  Confidence: ${confColour}${BOLD}${confPct}%${RESET}${' '.repeat(45 - confPct.length)}│\n`);
  process.stdout.write(`${CYAN}${BOLD}└─────────────────────────────────────────────────────────────┘${RESET}\n`);
  process.stdout.write('\n');
}

/**
 * Displays the import result summary to the terminal.
 */
function displayImportSummary(
  result: { totalAttempted: number; successCount: number; failureCount: number; failures: { sourceRowIndex: number; testCaseName: string; error: string; phase: string }[]; createdFolders: string[]; duration: number },
  dryRun: boolean
): void {
  const GREEN = '\x1b[32m';
  const RED = '\x1b[31m';
  const CYAN = '\x1b[36m';
  const DIM = '\x1b[2m';
  const BOLD = '\x1b[1m';
  const RESET = '\x1b[0m';

  const mode = dryRun ? 'DRY-RUN ' : '';
  process.stdout.write(`${CYAN}${BOLD}${'='.repeat(63)}${RESET}\n`);
  process.stdout.write(`  ${BOLD}${mode}Import Summary${RESET}\n`);
  process.stdout.write(`${CYAN}${BOLD}${'='.repeat(63)}${RESET}\n`);
  process.stdout.write(`  Total attempted:  ${BOLD}${result.totalAttempted}${RESET}\n`);
  process.stdout.write(`  Successful:       ${GREEN}${BOLD}${result.successCount}${RESET}\n`);
  process.stdout.write(`  Failed:           ${result.failureCount > 0 ? RED + BOLD : DIM}${result.failureCount}${RESET}\n`);
  process.stdout.write(`  Folders created:  ${result.createdFolders.length}\n`);
  process.stdout.write(`  Duration:         ${(result.duration / 1000).toFixed(1)}s\n`);

  if (result.failures.length > 0) {
    process.stdout.write(`\n  ${RED}${BOLD}Failures:${RESET}\n`);
    for (const f of result.failures.slice(0, 10)) {
      process.stdout.write(`    ${RED}x${RESET} Row ${f.sourceRowIndex} "${f.testCaseName}": ${DIM}${f.error}${RESET}\n`);
    }
    if (result.failures.length > 10) {
      process.stdout.write(`    ${DIM}... and ${result.failures.length - 10} more (see log file)${RESET}\n`);
    }
  }

  process.stdout.write(`${CYAN}${BOLD}${'='.repeat(63)}${RESET}\n`);
}

/**
 * Converts a fully-resolved PreAnalysisResult into a MappingResult
 * that the downstream transformer can consume.
 */
function convertPreAnalysisToMapping(preAnalysis: PreAnalysisResult): MappingResult {
  const fieldMappings: FieldMapping[] = [];

  for (const match of preAnalysis.resolvedMappings) {
    // Auto-ignored columns
    if (match.targetField === '__Ignore__') {
      fieldMappings.push({
        sourceColumn: match.sourceColumn,
        targetField: 'ignore',
        transformType: 'ignore',
      });
      continue;
    }

    // Folder path columns are handled via folderMapping, not fieldMappings
    if (match.targetField === '__FolderPath__') {
      continue;
    }

    const lookupMap = preAnalysis.valueLookups.get(match.targetField);
    const transformType = lookupMap ? 'lookup' : 'direct';

    fieldMappings.push({
      sourceColumn: match.sourceColumn,
      targetField: match.targetField,
      transformType,
      lookupMap,
    });
  }

  // Add folder mapping if detected
  const folderMapping = preAnalysis.structure.folderStructure.detected
    ? { sourceColumn: preAnalysis.structure.folderStructure.column!, pathSeparator: preAnalysis.structure.folderStructure.separator ?? '/' }
    : undefined;

  // Add test step mapping if detected
  let testStepMapping = undefined;
  const step = preAnalysis.structure.stepStructure;
  if (step.mode === 'separate-rows') {
    testStepMapping = {
      mode: 'separate-rows' as const,
      descriptionColumn: step.stepDescriptionColumn,
      expectedResultColumn: step.stepExpectedResultColumn,
      groupingColumn: step.groupingColumn,
    };
  } else if (step.mode === 'inline') {
    testStepMapping = {
      mode: 'inline' as const,
      descriptionColumn: step.inlineColumn,
      stepDelimiter: step.inlineDelimiter === 'semicolon' ? ';' : '\n',
    };
  }

  return {
    fieldMappings,
    testStepMapping,
    folderMapping,
    confidence: preAnalysis.resolvedMappings.length > 0
      ? Math.min(...preAnalysis.resolvedMappings.map(m => m.confidence))
      : 1.0,
    unmappedSourceColumns: preAnalysis.unresolvedColumns,
    unmappedTargetFields: [],
    notes: ['Mapping resolved entirely by heuristic pre-analysis (no LLM call).'],
  };
}

/**
 * Merges heuristic value lookup maps into an LLM-produced MappingResult.
 * For any lookup-type field mapping where the LLM provided a lookupMap,
 * overlay the heuristic resolutions (which are more reliable for known values).
 */
function mergeLookupMaps(mappingResult: MappingResult, preAnalysis: PreAnalysisResult): void {
  for (const fm of mappingResult.fieldMappings) {
    if (fm.transformType === 'lookup') {
      const heuristicMap = preAnalysis.valueLookups.get(fm.targetField);
      if (heuristicMap) {
        // Heuristic values override LLM values (more reliable)
        fm.lookupMap = { ...(fm.lookupMap ?? {}), ...heuristicMap };
      }
    }
  }
}
