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
import * as path from 'node:path';
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
import { extractAttachmentInfo, uploadAttachments, type PendingAttachment } from './importer/attachment-handler.js';
import { extractColumnInfo, writeProvisionerFile, findMissingListValues, inferFieldType as inferFieldTypeExported } from './provisioner/index.js';

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
  if (config.rootFolder) {
    process.stdout.write(`  ${BOLD}Root Folder:${RESET}   ${config.rootFolder}\n`);
  }
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

    // Add unresolved values for LLM to suggest mappings
    if (preAnalysis.unresolvedValues.length > 0) {
      contextLines.push('');
      contextLines.push('## Unresolved value mappings (suggest the best match or "SKIP"):');
      contextLines.push('For each source value below, suggest which target value NAME it should map to.');
      contextLines.push('Return the EXACT target NAME string from the available list (NOT the numeric ID). If no reasonable match exists, say "SKIP".');
      contextLines.push('');

      // Group by field and show available targets
      const byField = new Map<string, string[]>();
      for (const uv of preAnalysis.unresolvedValues) {
        if (!byField.has(uv.field)) byField.set(uv.field, []);
        byField.get(uv.field)!.push(uv.sourceValue);
      }

      for (const [field, values] of byField) {
        // Get available target values for this field
        let availableTargets: string[] = [];
        const lookup = metadata.priorities.map(p => p.name);
        if (field === 'TestCasePriorityId') availableTargets = metadata.priorities.map(p => p.name);
        else if (field === 'TestCaseStatusId') availableTargets = metadata.statuses.map(s => s.name);
        else if (field === 'TestCaseTypeId') availableTargets = metadata.types.map(t => t.name);
        else {
          // Custom property list
          const cp = metadata.customProperties.find(p => p.name === field);
          if (cp?.customListId) {
            const listValues = metadata.customLists.get(cp.customListId);
            if (listValues) availableTargets = listValues.map(v => v.name);
          }
        }

        contextLines.push(`Field: ${field}`);
        contextLines.push(`  Source values needing resolution: ${values.map(v => `"${v}"`).join(', ')}`);
        contextLines.push(`  Available targets: ${availableTargets.map(t => `"${t}"`).join(', ')}`);
        contextLines.push('');
      }
    }

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
    try {
      mappingResult = await mappingEngine.generateMapping(selectedSheet, metadata, 5, preAnalysisContextStr);
    } catch (llmError) {
      const msg = llmError instanceof Error ? llmError.message : String(llmError);
      logger.error(`LLM mapping failed: ${msg}`);
      process.stdout.write(`\n\x1b[33m[WARNING] LLM failed to generate a valid mapping. Falling back to heuristic-only results.\x1b[0m\n`);
      process.stdout.write(`\x1b[2mYou can still export unmatched fields for SpiraProvisioner or provide feedback.\x1b[0m\n\n`);
      mappingResult = convertPreAnalysisToMapping(preAnalysis);
    }
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
        heuristicResolved.delete(fm.sourceColumn); // Mark as handled
      }
    }
    // Add any heuristic-resolved columns not present in LLM response
    for (const [sourceColumn, heuristic] of heuristicResolved) {
      if (heuristic.targetField === '__Ignore__') continue; // Ignores don't need adding
      const lookupMap = preAnalysis.valueLookups.get(heuristic.targetField);
      mappingResult.fieldMappings.push({
        sourceColumn,
        targetField: heuristic.targetField,
        transformType: lookupMap ? 'lookup' : 'direct',
        lookupMap,
      });
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
    // Process LLM value suggestions — resolve suggested target names to IDs
    processValueSuggestions(mappingResult, metadata);
    logger.info(`LLM mapping generated with confidence: ${mappingResult.confidence}`);
  }

  // Phase 5: User Mapping Review
  let mappingApproved = false;
  while (!mappingApproved) {
    displayMappingSummary(mappingResult);

    const hasValueSuggestions = mappingResult.valueSuggestions && mappingResult.valueSuggestions.length > 0;
    const hasUnresolvedColumns = preAnalysis.unresolvedColumns.length > 0;
    const choices: { name: string; value: string }[] = [
      { name: 'Accept mapping and continue', value: 'accept' },
    ];
    if (hasValueSuggestions) {
      choices.push({ name: 'Edit value mappings', value: 'editValues' });
    }
    if (hasUnresolvedColumns) {
      choices.push({ name: 'Export unmatched fields for SpiraProvisioner', value: 'exportProvisioner' });
    }
    choices.push({ name: 'Provide feedback and regenerate', value: 'feedback' });
    choices.push({ name: 'Abort import', value: 'abort' });

    const reviewChoice = await select({
      message: 'Review the proposed mapping:',
      choices,
    });

    if (reviewChoice === 'accept') {
      mappingApproved = true;
    } else if (reviewChoice === 'editValues') {
      // Let the user override each value suggestion
      for (let i = 0; i < mappingResult.valueSuggestions!.length; i++) {
        const vs = mappingResult.valueSuggestions![i];
        // Get available targets for this field
        let targets: string[] = [];
        if (vs.field === 'TestCasePriorityId') targets = metadata.priorities.map(p => p.name);
        else if (vs.field === 'TestCaseStatusId') targets = metadata.statuses.map(s => s.name);
        else if (vs.field === 'TestCaseTypeId') targets = metadata.types.map(t => t.name);
        else {
          const cp = metadata.customProperties.find(p => p.name === vs.field);
          if (cp?.customListId) {
            const listValues = metadata.customLists.get(cp.customListId);
            if (listValues) targets = listValues.map(v => v.name);
          }
        }

        const targetChoices = [
          ...targets.map(t => ({ name: t, value: t })),
          { name: '(skip - leave blank)', value: 'SKIP' },
        ];

        const picked = await select({
          message: `${vs.field}: "${vs.sourceValue}" → currently "${vs.suggestedTarget}". Map to:`,
          choices: targetChoices,
          default: vs.suggestedTarget,
        });

        mappingResult.valueSuggestions![i] = { ...vs, suggestedTarget: picked };
      }

      // Re-process the edited suggestions into lookup maps
      processValueSuggestions(mappingResult, metadata);
      // Re-display
    } else if (reviewChoice === 'exportProvisioner') {
      // Generate SpiraProvisioner JSON for unmatched columns + missing list values
      const programName = await input({
        message: 'Program name in Spira (must already exist):',
        default: 'Default Program',
      });
      const productName = await input({
        message: 'Product name to add fields to:',
        default: metadata.projectId ? `Project ${metadata.projectId}` : 'My Product',
      });

      // New columns that don't exist in Spira
      const newColumnInfo = extractColumnInfo(selectedSheet.rows, preAnalysis.unresolvedColumns);

      // Existing list properties with missing values
      const missingValues = findMissingListValues(
        selectedSheet.rows,
        preAnalysis.resolvedMappings,
        metadata.customProperties,
        metadata.customLists,
      );

      const outputPath = writeProvisionerFile(
        { programName, productName, newColumns: newColumnInfo, missingValues },
        process.cwd(),
      );

      const GREEN = '\x1b[32m';
      const YELLOW = '\x1b[33m';
      const BOLD = '\x1b[1m';
      const RESET = '\x1b[0m';
      process.stdout.write(`\n${GREEN}${BOLD}Provisioner config written to:${RESET} ${outputPath}\n\n`);

      // Summary of what it contains
      if (newColumnInfo.length > 0) {
        process.stdout.write(`${BOLD}New custom properties to create:${RESET}\n`);
        for (const col of newColumnInfo) {
          const { type, variabilityScore } = inferFieldTypeExported(col, 20);
          const scoreBar = variabilityScore <= 0.2 ? `${GREEN}list${RESET}` :
            variabilityScore <= 0.4 ? `${YELLOW}maybe-list${RESET}` : `text`;
          process.stdout.write(`  + ${col.columnName} → ${BOLD}${type}${RESET} (variability: ${(variabilityScore * 100).toFixed(0)}% → ${scoreBar}, ${col.uniqueValues.length} unique values)\n`);
        }
        process.stdout.write('\n');
      }
      if (missingValues.length > 0) {
        process.stdout.write(`${BOLD}Missing list values to add:${RESET}\n`);
        for (const mv of missingValues) {
          process.stdout.write(`  ${YELLOW}${mv.propertyName}:${RESET} +${mv.missingValues.length} values (${mv.missingValues.slice(0, 5).join(', ')}${mv.missingValues.length > 5 ? '...' : ''})\n`);
        }
        process.stdout.write('\n');
      }

      process.stdout.write(`Run SpiraProvisioner with this file to update the template, then re-run this import.\n\n`);
      // Don't approve — let the user review again or abort
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

  // Apply root folder prefix if configured
  if (config.rootFolder) {
    const separator = mappingResult.folderMapping?.pathSeparator ?? '/';
    for (const tc of transformResult.testCases) {
      if (tc.folderPath) {
        tc.folderPath = `${config.rootFolder}${separator}${tc.folderPath}`;
      } else {
        tc.folderPath = config.rootFolder;
      }
    }
    logger.info(`Root folder: "${config.rootFolder}" — all test cases will be imported under this folder.`);
  }

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

  // Phase 9: Attachment upload
  if (!config.dryRun && importResult.createdTestCases.size > 0) {
    // Find attachment columns (those auto-ignored by heuristics)
    const attachmentColumns = preAnalysis.resolvedMappings
      .filter(m => m.targetField === '__Ignore__' && m.matchReason === 'auto-ignore')
      .map(m => m.sourceColumn);

    if (attachmentColumns.length > 0) {
      const pendingAttachments: PendingAttachment[] = [];
      const sourceDir = path.dirname(path.resolve(config.sourceFile));

      // Scan source rows for attachment values, grouped by test case
      for (const tc of transformResult.testCases) {
        const testCaseId = importResult.createdTestCases.get(tc.sourceRowIndex);
        if (!testCaseId) continue;

        // Find the source row for this test case
        const sourceRow = selectedSheet.rows[tc.sourceRowIndex];
        if (!sourceRow) continue;

        for (const col of attachmentColumns) {
          const cellValue = sourceRow[col];
          const info = extractAttachmentInfo(cellValue);
          if (info) {
            pendingAttachments.push({
              testCaseId,
              sourceRowIndex: tc.sourceRowIndex,
              filename: info.filename,
              filePath: info.filePath,
            });
          }
        }
      }

      if (pendingAttachments.length > 0) {
        logger.info(`Phase 9: Uploading ${pendingAttachments.length} attachment(s)...`);
        const attachResult = await uploadAttachments(pendingAttachments, {
          client: spiraClient,
          logger,
          projectId: config.spira.projectId,
          baseDir: sourceDir,
        });
        if (attachResult.successCount > 0 || attachResult.failureCount > 0) {
          process.stdout.write(`  Attachments: ${attachResult.successCount} uploaded, ${attachResult.skippedCount} skipped, ${attachResult.failureCount} failed\n`);
        }
      }
    }
  }

  // Phase 10: Summary & Persist Log
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

  // Value suggestions from LLM
  if (mapping.valueSuggestions && mapping.valueSuggestions.length > 0) {
    process.stdout.write(`${CYAN}\u251c${'─'.repeat(61)}\u2524${RESET}\n`);
    process.stdout.write(`\u2502  ${BOLD}Value Mappings${RESET}\n`);
    for (const vs of mapping.valueSuggestions) {
      const skipped = vs.suggestedTarget.toUpperCase() === 'SKIP';
      const colour = skipped ? DIM : YELLOW;
      const arrow = skipped ? ' x ' : ' -> ';
      // Display the target name (not ID). If LLM returned a number, use the reason field which often has the name.
      let displayTarget = vs.suggestedTarget;
      if (!skipped && /^\d+$/.test(vs.suggestedTarget) && vs.reason) {
        // LLM returned an ID — extract name from reason if possible
        displayTarget = vs.reason;
      }
      const target = skipped ? 'SKIP (no match)' : displayTarget;
      process.stdout.write(`\u2502  ${colour}${vs.field}: "${vs.sourceValue}"${arrow}${target}${RESET}\n`);
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

/**
 * Processes value suggestions: resolves suggested target names to Spira IDs
 * and merges them into the field mapping lookupMaps.
 */
function processValueSuggestions(mappingResult: MappingResult, metadata: TemplateMetadata): void {
  if (!mappingResult.valueSuggestions) return;

  for (const suggestion of mappingResult.valueSuggestions) {
    if (suggestion.suggestedTarget.toUpperCase() === 'SKIP') continue;

    let resolvedId: number | undefined;

    // Check if LLM returned a numeric ID directly
    const numericId = Number(suggestion.suggestedTarget);
    if (!isNaN(numericId) && Number.isInteger(numericId)) {
      // Validate the ID exists in the lookup
      resolvedId = numericId;
    }

    // Try matching by name
    if (resolvedId === undefined) {
      if (suggestion.field === 'TestCasePriorityId') {
        const match = metadata.priorities.find(p => p.name.toLowerCase() === suggestion.suggestedTarget.toLowerCase());
        resolvedId = match?.priorityId;
      } else if (suggestion.field === 'TestCaseStatusId') {
        const match = metadata.statuses.find(s => s.name.toLowerCase() === suggestion.suggestedTarget.toLowerCase());
        resolvedId = match?.testCaseStatusId;
      } else if (suggestion.field === 'TestCaseTypeId') {
        const match = metadata.types.find(t => t.name.toLowerCase() === suggestion.suggestedTarget.toLowerCase());
        resolvedId = match?.testCaseTypeId;
      } else {
        const cp = metadata.customProperties.find(p => p.name === suggestion.field);
        if (cp?.customListId) {
          const listValues = metadata.customLists.get(cp.customListId);
          const match = listValues?.find(v => v.name.toLowerCase() === suggestion.suggestedTarget.toLowerCase());
          resolvedId = match?.customPropertyValueId;
        }
      }
    }

    if (resolvedId !== undefined) {
      const fm = mappingResult.fieldMappings.find(f => f.targetField === suggestion.field);
      if (fm) {
        if (!fm.lookupMap) fm.lookupMap = {};
        fm.lookupMap[suggestion.sourceValue] = resolvedId;
        if (fm.transformType === 'direct') fm.transformType = 'lookup';
      }
    }
  }
}
