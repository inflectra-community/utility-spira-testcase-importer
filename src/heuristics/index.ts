/**
 * Heuristics Pre-Analysis Module — Orchestrator
 *
 * Coordinates column matching, value resolution, and structure detection
 * into a single pre-analysis pass. Produces a PreAnalysisResult that either
 * fully resolves the mapping (skipping the LLM) or identifies which columns
 * need LLM assistance.
 */

import type { SheetData } from '../parser/index.js';
import type { PreAnalysisConfig, PreAnalysisResult, StructureDetectionResult } from './types.js';
import { matchColumns } from './column-matcher.js';
import { resolveValues } from './value-resolver.js';
import { detectStructure } from './structure-detector.js';

export type { PreAnalysisResult, PreAnalysisConfig } from './types.js';

/**
 * Runs the full heuristic pre-analysis on a parsed spreadsheet.
 *
 * Flow:
 * 1. Detect structure (step mode, folder column) — claims columns
 * 2. Match remaining columns to Spira fields
 * 3. Resolve values for lookup-type fields
 * 4. Compute whether everything is resolved or LLM is needed
 */
export function analyzeSpreadsheet(
  sheet: SheetData,
  config: PreAnalysisConfig,
): PreAnalysisResult {
  const { fieldDefinitions, metadata } = config;

  // Phase 1: Structure detection
  const structure = detectStructure(sheet.headers, sheet.rows);

  // Columns claimed by structure detection (won't be matched again)
  const structureClaimedColumns = new Set<string>();
  if (structure.stepStructure.stepNumberColumn) {
    structureClaimedColumns.add(structure.stepStructure.stepNumberColumn);
  }
  if (structure.stepStructure.stepDescriptionColumn) {
    structureClaimedColumns.add(structure.stepStructure.stepDescriptionColumn);
  }
  if (structure.stepStructure.stepExpectedResultColumn) {
    structureClaimedColumns.add(structure.stepStructure.stepExpectedResultColumn);
  }
  if (structure.folderStructure.detected && structure.folderStructure.column) {
    structureClaimedColumns.add(structure.folderStructure.column);
  }

  // Phase 2: Column matching (only unclaimed columns)
  const headersToMatch = sheet.headers.filter(h => !structureClaimedColumns.has(h));
  const columnResult = matchColumns(headersToMatch, {
    fieldDefinitions,
    customPropertyNames: metadata.customProperties.map(cp => cp.name),
  });

  // Phase 3: Value resolution for lookup-type fields
  const lookupFieldNames = new Set(['TestCasePriorityId', 'TestCaseStatusId', 'TestCaseTypeId', 'OwnerId', 'ComponentIds']);
  const resolvedLookupColumns = new Map<string, string>();
  for (const match of columnResult.matches) {
    if (lookupFieldNames.has(match.targetField) && match.confidence >= 0.7) {
      resolvedLookupColumns.set(match.sourceColumn, match.targetField);
    }
  }

  const valueResult = resolveValues(
    sheet.rows,
    resolvedLookupColumns,
    {
      priorities: metadata.lookups.find(l => l.fieldName === 'TestCasePriorityId')?.entries.map(e => ({ id: e.id, name: e.name })) ?? [],
      statuses: metadata.lookups.find(l => l.fieldName === 'TestCaseStatusId')?.entries.map(e => ({ id: e.id, name: e.name })) ?? [],
      types: metadata.lookups.find(l => l.fieldName === 'TestCaseTypeId')?.entries.map(e => ({ id: e.id, name: e.name })) ?? [],
      users: metadata.users.map(u => ({ id: u.userId, fullName: u.fullName, userName: u.userName })),
      components: metadata.components.map(c => ({ id: c.componentId, name: c.name })),
      customLists: new Map(
        [...metadata.customLists.entries()].map(([listId, values]) => [
          listId,
          values.map(v => ({ id: v.customPropertyValueId, name: v.name })),
        ]),
      ),
    },
  );

  // Phase 4: Compute overall resolution status
  const allColumns = new Set(sheet.headers);
  const resolvedColumns = new Set([
    ...columnResult.matches.filter(m => m.confidence >= 0.7).map(m => m.sourceColumn),
    ...structureClaimedColumns,
  ]);
  const unresolvedColumns = [...allColumns].filter(c => !resolvedColumns.has(c));

  const fullyResolved = unresolvedColumns.length === 0 &&
    valueResult.unresolvedValues.length === 0 &&
    columnResult.ambiguous.length === 0;

  // Phase 5: Build summary
  const summary = buildSummary(
    columnResult.matches,
    structureClaimedColumns,
    structure,
    valueResult,
    unresolvedColumns,
    fullyResolved,
  );

  return {
    resolvedMappings: columnResult.matches,
    valueLookups: valueResult.lookupMaps,
    structure,
    unresolvedColumns,
    unresolvedValues: valueResult.unresolvedValues,
    fullyResolved,
    summary,
  };
}

function buildSummary(
  matches: { sourceColumn: string; targetField: string; confidence: number; matchReason: string }[],
  structureClaimed: Set<string>,
  structure: StructureDetectionResult,
  valueResult: { lookupMaps: Map<string, Record<string, number>>; unresolvedValues: { field: string; sourceValue: string }[] },
  unresolvedColumns: string[],
  fullyResolved: boolean,
): string {
  const lines: string[] = [];

  lines.push('─── Heuristic Pre-Analysis Summary ───');
  lines.push('');

  // Structure
  if (structure.stepStructure.mode !== 'none') {
    lines.push(`  Step mode: ${structure.stepStructure.mode} (confidence: ${(structure.stepStructure.confidence * 100).toFixed(0)}%)`);
  }
  if (structure.folderStructure.detected) {
    lines.push(`  Folder column: "${structure.folderStructure.column}" (separator: "${structure.folderStructure.separator}")`);
  }

  // Resolved columns
  const highConfidence = matches.filter(m => m.confidence >= 0.9);
  const medConfidence = matches.filter(m => m.confidence >= 0.7 && m.confidence < 0.9);
  if (highConfidence.length > 0) {
    lines.push('');
    lines.push(`  Resolved (high confidence): ${highConfidence.length} columns`);
    for (const m of highConfidence) {
      lines.push(`    "${m.sourceColumn}" → ${m.targetField} (${m.matchReason})`);
    }
  }
  if (medConfidence.length > 0) {
    lines.push(`  Resolved (medium confidence): ${medConfidence.length} columns`);
    for (const m of medConfidence) {
      lines.push(`    "${m.sourceColumn}" → ${m.targetField} (${m.matchReason}, ${(m.confidence * 100).toFixed(0)}%)`);
    }
  }

  // Value resolution
  let totalValues = 0;
  for (const [, map] of valueResult.lookupMaps) {
    totalValues += Object.keys(map).length;
  }
  if (totalValues > 0) {
    lines.push(`  Values resolved: ${totalValues} unique values mapped to IDs`);
  }
  if (valueResult.unresolvedValues.length > 0) {
    lines.push(`  Unresolved values: ${valueResult.unresolvedValues.length}`);
  }

  // Unresolved columns
  if (unresolvedColumns.length > 0) {
    lines.push('');
    lines.push(`  Needs LLM: ${unresolvedColumns.length} columns`);
    for (const col of unresolvedColumns) {
      lines.push(`    "${col}"`);
    }
  }

  lines.push('');
  lines.push(fullyResolved
    ? '  ✓ Fully resolved — LLM call can be skipped'
    : `  → LLM needed for ${unresolvedColumns.length} column(s)`);

  return lines.join('\n');
}
