/**
 * Headless Excel mapping core.
 *
 * Extracts the Excel mapping pipeline stage (heuristic pre-analysis → LLM
 * mapping → merge) from the CLI orchestrator so it can be reused by any
 * adapter (CLI, web). No stdout, no prompts — only typed input/output plus a
 * Logger for diagnostics.
 *
 * Both src/pipeline.ts (CLI) and src/web/server.ts (web) call
 * `generateExcelMapping()` to go from a parsed sheet + metadata to a
 * MappingResult ready for user review, then `applyValueSuggestions()` after
 * the user edits value mappings.
 */

import type { Logger } from '../logger/index.js';
import type { LLMConfig } from '../types/config.js';
import type { TemplateMetadata } from '../types/spira.js';
import type { SheetData } from '../parser/index.js';
import type { MappingResult, FieldMapping } from '../types/mapping.js';
import type { FieldDefinition } from '../types/strategy.js';
import { analyzeSpreadsheet, type PreAnalysisResult } from '../heuristics/index.js';
import { createMappingEngine } from '../mapping/engine.js';

/** Default test-case field definitions used when no strategy is supplied. */
export const DEFAULT_TEST_CASE_FIELDS: FieldDefinition[] = [
  { name: 'Name', label: 'Name', type: 'string', required: true, description: 'Test case name' },
  { name: 'Description', label: 'Description', type: 'string', required: false, description: 'Description' },
  { name: 'TestCasePriorityId', label: 'Priority', type: 'integer', required: false, description: 'Priority ID' },
  { name: 'TestCaseStatusId', label: 'Status', type: 'integer', required: false, description: 'Status ID' },
  { name: 'TestCaseTypeId', label: 'Type', type: 'integer', required: false, description: 'Type ID' },
  { name: 'OwnerId', label: 'Owner', type: 'integer', required: false, description: 'Owner user ID' },
  { name: 'ComponentIds', label: 'Components', type: 'integer[]', required: false, description: 'Component IDs' },
  { name: 'Tags', label: 'Tags', type: 'string', required: false, description: 'Tags' },
];

/** Builds the heuristics config from template metadata. */
export function buildHeuristicConfig(metadata: TemplateMetadata, fieldDefinitions: FieldDefinition[]) {
  return {
    fieldDefinitions,
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
  };
}

/** Runs heuristic pre-analysis, with a graceful fallback to full-LLM mode. */
export function runHeuristics(
  sheet: SheetData,
  metadata: TemplateMetadata,
  fieldDefinitions: FieldDefinition[],
  logger: Logger,
): PreAnalysisResult {
  try {
    return analyzeSpreadsheet(sheet, buildHeuristicConfig(metadata, fieldDefinitions));
  } catch (heuristicError) {
    const msg = heuristicError instanceof Error ? heuristicError.stack ?? heuristicError.message : String(heuristicError);
    logger.warn(`Heuristic pre-analysis failed (falling back to full LLM): ${msg}`);
    return {
      fullyResolved: false,
      resolvedMappings: [],
      valueLookups: new Map(),
      structure: { stepStructure: { mode: 'none', confidence: 0 }, folderStructure: { detected: false, confidence: 0 } },
      unresolvedColumns: sheet.headers,
      unresolvedValues: [],
      summary: '  Heuristic analysis failed - using full LLM mode.',
    };
  }
}

/** Builds the pre-analysis context string appended to the LLM prompt. */
export function buildPreAnalysisContext(preAnalysis: PreAnalysisResult, metadata: TemplateMetadata): string {
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
    for (const name of cpNames) contextLines.push(`- "${name}"`);
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

  if (preAnalysis.unresolvedValues.length > 0) {
    contextLines.push('');
    contextLines.push('## Unresolved value mappings (suggest the best match or "SKIP"):');
    contextLines.push('For each source value below, suggest which target value NAME it should map to.');
    contextLines.push('Return the EXACT target NAME string from the available list (NOT the numeric ID). If no reasonable match exists, say "SKIP".');
    contextLines.push('');

    const byField = new Map<string, string[]>();
    for (const uv of preAnalysis.unresolvedValues) {
      if (!byField.has(uv.field)) byField.set(uv.field, []);
      byField.get(uv.field)!.push(uv.sourceValue);
    }

    for (const [field, values] of byField) {
      let availableTargets: string[] = [];
      if (field === 'TestCasePriorityId') availableTargets = metadata.priorities.map(p => p.name);
      else if (field === 'TestCaseStatusId') availableTargets = metadata.statuses.map(s => s.name);
      else if (field === 'TestCaseTypeId') availableTargets = metadata.types.map(t => t.name);
      else {
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

  return contextLines.join('\n');
}

/**
 * The outcome of the Excel mapping stage.
 * `usedLlm` is false when heuristics fully resolved the mapping.
 * `llmFailed` is true when the LLM call errored and we fell back to heuristics.
 */
export interface ExcelMappingResult {
  mapping: MappingResult;
  preAnalysis: PreAnalysisResult;
  usedLlm: boolean;
  llmFailed: boolean;
}

/**
 * Full Excel mapping stage: heuristics → (LLM if needed) → merge heuristic
 * answers back over the LLM result. Returns a MappingResult ready for review.
 *
 * This is the single source of truth for the merge sequence; both the CLI and
 * web adapters call it so the logic never diverges.
 */
export async function generateExcelMapping(
  sheet: SheetData,
  metadata: TemplateMetadata,
  llmConfig: LLMConfig,
  fieldDefinitions: FieldDefinition[],
  logger: Logger,
): Promise<ExcelMappingResult> {
  const preAnalysis = runHeuristics(sheet, metadata, fieldDefinitions, logger);

  if (preAnalysis.fullyResolved) {
    logger.info('Heuristics fully resolved the mapping - skipping LLM call.');
    return { mapping: convertPreAnalysisToMapping(preAnalysis), preAnalysis, usedLlm: false, llmFailed: false };
  }

  logger.info(`Generating field mapping via LLM (${preAnalysis.unresolvedColumns.length} columns need LLM)...`);
  const engine = createMappingEngine(llmConfig);
  const context = buildPreAnalysisContext(preAnalysis, metadata);
  logger.info(`LLM context: ${context.length} chars (~${Math.ceil(context.length / 4)} tokens).`);

  let mapping: MappingResult;
  let llmFailed = false;
  try {
    mapping = await engine.generateMapping(sheet, metadata, 5, context);
  } catch (llmError) {
    const msg = llmError instanceof Error ? llmError.message : String(llmError);
    logger.error(`LLM mapping failed: ${msg}`);
    llmFailed = true;
    mapping = convertPreAnalysisToMapping(preAnalysis);
  }

  mergeHeuristicsIntoMapping(mapping, preAnalysis, metadata);
  logger.info(`Mapping generated with confidence: ${mapping.confidence}`);

  return { mapping, preAnalysis, usedLlm: !llmFailed, llmFailed };
}

/**
 * Merges heuristic results into an LLM-produced MappingResult (in place).
 * Order matters — this is the canonical sequence that both adapters rely on.
 */
export function mergeHeuristicsIntoMapping(
  mappingResult: MappingResult,
  preAnalysis: PreAnalysisResult,
  metadata: TemplateMetadata,
): void {
  mergeLookupMaps(mappingResult, preAnalysis);

  // Override LLM field mappings for columns the heuristics already resolved.
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
      heuristicResolved.delete(fm.sourceColumn);
    }
  }
  // Add any heuristic-resolved columns not present in LLM response.
  for (const [sourceColumn, heuristic] of heuristicResolved) {
    if (heuristic.targetField === '__Ignore__') continue;
    const lookupMap = preAnalysis.valueLookups.get(heuristic.targetField);
    mappingResult.fieldMappings.push({
      sourceColumn,
      targetField: heuristic.targetField,
      transformType: lookupMap ? 'lookup' : 'direct',
      lookupMap,
    });
  }
  // Remove step columns — handled by testStepMapping.
  const stepColumns = new Set<string>();
  if (preAnalysis.structure.stepStructure.stepNumberColumn) stepColumns.add(preAnalysis.structure.stepStructure.stepNumberColumn);
  if (preAnalysis.structure.stepStructure.stepDescriptionColumn) stepColumns.add(preAnalysis.structure.stepStructure.stepDescriptionColumn);
  if (preAnalysis.structure.stepStructure.stepExpectedResultColumn) stepColumns.add(preAnalysis.structure.stepStructure.stepExpectedResultColumn);
  if (stepColumns.size > 0) {
    mappingResult.fieldMappings = mappingResult.fieldMappings.filter(fm => !stepColumns.has(fm.sourceColumn));
  }
  // Remove folder column — handled by folderMapping.
  if (preAnalysis.structure.folderStructure.detected && preAnalysis.structure.folderStructure.column) {
    const folderCol = preAnalysis.structure.folderStructure.column;
    mappingResult.fieldMappings = mappingResult.fieldMappings.filter(fm => fm.sourceColumn !== folderCol);
  }
  // Re-apply structure-detected step mapping (LLM may not return it).
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
  processValueSuggestions(mappingResult, metadata);
}

/** Converts a fully-resolved PreAnalysisResult into a MappingResult. */
export function convertPreAnalysisToMapping(preAnalysis: PreAnalysisResult): MappingResult {
  const fieldMappings: FieldMapping[] = [];

  for (const match of preAnalysis.resolvedMappings) {
    if (match.targetField === '__Ignore__') {
      fieldMappings.push({ sourceColumn: match.sourceColumn, targetField: 'ignore', transformType: 'ignore' });
      continue;
    }
    if (match.targetField === '__FolderPath__') continue;

    const lookupMap = preAnalysis.valueLookups.get(match.targetField);
    fieldMappings.push({
      sourceColumn: match.sourceColumn,
      targetField: match.targetField,
      transformType: lookupMap ? 'lookup' : 'direct',
      lookupMap,
    });
  }

  const folderMapping = preAnalysis.structure.folderStructure.detected
    ? { sourceColumn: preAnalysis.structure.folderStructure.column!, pathSeparator: preAnalysis.structure.folderStructure.separator ?? '/' }
    : undefined;

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

/** Overlays heuristic value lookups onto lookup-type field mappings. */
export function mergeLookupMaps(mappingResult: MappingResult, preAnalysis: PreAnalysisResult): void {
  for (const fm of mappingResult.fieldMappings) {
    if (fm.transformType === 'lookup') {
      const heuristicMap = preAnalysis.valueLookups.get(fm.targetField);
      if (heuristicMap) {
        fm.lookupMap = { ...(fm.lookupMap ?? {}), ...heuristicMap };
      }
    }
  }
}

/**
 * Resolves LLM/user value suggestions to Spira IDs and folds them into the
 * relevant field mapping's lookupMap. Call again after the user edits values.
 */
export function processValueSuggestions(mappingResult: MappingResult, metadata: TemplateMetadata): void {
  if (!mappingResult.valueSuggestions) return;

  for (const suggestion of mappingResult.valueSuggestions) {
    if (suggestion.suggestedTarget.toUpperCase() === 'SKIP') continue;

    let resolvedId: number | undefined;
    const numericId = Number(suggestion.suggestedTarget);
    if (!isNaN(numericId) && Number.isInteger(numericId)) {
      resolvedId = numericId;
    }

    if (resolvedId === undefined) {
      if (suggestion.field === 'TestCasePriorityId') {
        resolvedId = metadata.priorities.find(p => p.name.toLowerCase() === suggestion.suggestedTarget.toLowerCase())?.priorityId;
      } else if (suggestion.field === 'TestCaseStatusId') {
        resolvedId = metadata.statuses.find(s => s.name.toLowerCase() === suggestion.suggestedTarget.toLowerCase())?.testCaseStatusId;
      } else if (suggestion.field === 'TestCaseTypeId') {
        resolvedId = metadata.types.find(t => t.name.toLowerCase() === suggestion.suggestedTarget.toLowerCase())?.testCaseTypeId;
      } else {
        const cp = metadata.customProperties.find(p => p.name === suggestion.field);
        if (cp?.customListId) {
          const listValues = metadata.customLists.get(cp.customListId);
          resolvedId = listValues?.find(v => v.name.toLowerCase() === suggestion.suggestedTarget.toLowerCase())?.customPropertyValueId;
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

/** Available target value names for a given lookup field (for UI dropdowns). */
export function availableTargetsForField(field: string, metadata: TemplateMetadata): string[] {
  if (field === 'TestCasePriorityId') return metadata.priorities.map(p => p.name);
  if (field === 'TestCaseStatusId') return metadata.statuses.map(s => s.name);
  if (field === 'TestCaseTypeId') return metadata.types.map(t => t.name);
  const cp = metadata.customProperties.find(p => p.name === field);
  if (cp?.customListId) {
    const listValues = metadata.customLists.get(cp.customListId);
    if (listValues) return listValues.map(v => v.name);
  }
  return [];
}
