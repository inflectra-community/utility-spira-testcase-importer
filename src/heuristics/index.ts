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
import type { LookupEntry } from './types.js';
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
  let structure = detectStructure(sheet.headers, sheet.rows);

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
    // Don't claim folder column if a custom property with the same name exists
    const folderCol = structure.folderStructure.column;
    const cpNames = metadata.customProperties.map(cp => cp.name?.toLowerCase()).filter(Boolean);
    if (!cpNames.includes(folderCol.toLowerCase())) {
      structureClaimedColumns.add(folderCol);
    } else {
      // Custom property takes priority — create a new structure without folder detection
      structure = {
        ...structure,
        folderStructure: { detected: false, confidence: 0 },
      };
    }
  }

  // Phase 2: Column matching (only unclaimed columns)
  const headersToMatch = sheet.headers.filter(h => !structureClaimedColumns.has(h));
  const columnResult = matchColumns(headersToMatch, {
    fieldDefinitions,
    customPropertyNames: metadata.customProperties.map(cp => cp.name).filter(Boolean),
  });

  // Phase 3: Value resolution for lookup-type fields
  const lookupFieldNames = new Set(['TestCasePriorityId', 'TestCaseStatusId', 'TestCaseTypeId', 'OwnerId', 'ComponentIds']);
  const resolvedLookupColumns = new Map<string, string>();
  for (const match of columnResult.matches) {
    if (lookupFieldNames.has(match.targetField) && match.confidence >= 0.7) {
      resolvedLookupColumns.set(match.sourceColumn, match.targetField);
    }
  }

  // Also resolve custom properties with lists
  const customPropertyListEntries = new Map<string, LookupEntry[]>();
  for (const match of columnResult.matches) {
    if (match.confidence < 0.7) continue;
    // Find the custom property this maps to
    const cp = metadata.customProperties.find(p => p.name === match.targetField);
    if (cp && cp.customListId != null) {
      const listValues = metadata.customLists.get(cp.customListId);
      if (listValues && listValues.length > 0) {
        resolvedLookupColumns.set(match.sourceColumn, match.targetField);
        customPropertyListEntries.set(match.targetField, listValues.map(v => ({
          id: v.customPropertyValueId,
          name: v.name,
        })));
      }
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
      customPropertyListEntries: customPropertyListEntries,
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
  // ANSI colour codes
  const GREEN = '\x1b[32m';
  const YELLOW = '\x1b[33m';
  const RED = '\x1b[31m';
  const CYAN = '\x1b[36m';
  const DIM = '\x1b[2m';
  const BOLD = '\x1b[1m';
  const RESET = '\x1b[0m';

  const lines: string[] = [];

  lines.push(`${BOLD}${CYAN}─── Heuristic Pre-Analysis Summary ───${RESET}`);
  lines.push('');

  // Structure
  if (structure.stepStructure.mode !== 'none') {
    const conf = structure.stepStructure.confidence;
    const colour = conf >= 0.8 ? GREEN : conf >= 0.6 ? YELLOW : RED;
    lines.push(`  ${BOLD}Step mode:${RESET} ${structure.stepStructure.mode} ${colour}(${(conf * 100).toFixed(0)}%)${RESET}`);
  }
  if (structure.folderStructure.detected) {
    const conf = structure.folderStructure.confidence;
    const colour = conf >= 0.8 ? GREEN : conf >= 0.6 ? YELLOW : RED;
    lines.push(`  ${BOLD}Folder column:${RESET} "${structure.folderStructure.column}" ${DIM}separator: "${structure.folderStructure.separator}"${RESET} ${colour}(${(conf * 100).toFixed(0)}%)${RESET}`);
  }

  // Resolved columns
  const highConfidence = matches.filter(m => m.confidence >= 0.9);
  const medConfidence = matches.filter(m => m.confidence >= 0.7 && m.confidence < 0.9);
  if (highConfidence.length > 0) {
    lines.push('');
    lines.push(`  ${GREEN}${BOLD}Resolved (high confidence): ${highConfidence.length} columns${RESET}`);
    for (const m of highConfidence) {
      const bar = confidenceBar(m.confidence);
      lines.push(`    ${GREEN}${bar}${RESET} "${m.sourceColumn}" ${DIM}->${RESET} ${BOLD}${m.targetField}${RESET} ${DIM}(${m.matchReason})${RESET}`);
    }
  }
  if (medConfidence.length > 0) {
    lines.push('');
    lines.push(`  ${YELLOW}${BOLD}Resolved (medium confidence): ${medConfidence.length} columns${RESET}`);
    for (const m of medConfidence) {
      const bar = confidenceBar(m.confidence);
      lines.push(`    ${YELLOW}${bar}${RESET} "${m.sourceColumn}" ${DIM}->${RESET} ${BOLD}${m.targetField}${RESET} ${DIM}(${m.matchReason}, ${(m.confidence * 100).toFixed(0)}%)${RESET}`);
    }
  }

  // Value resolution
  let totalValues = 0;
  for (const [, map] of valueResult.lookupMaps) {
    totalValues += Object.keys(map).length;
  }
  if (totalValues > 0) {
    lines.push('');
    lines.push(`  ${GREEN}Values resolved:${RESET} ${totalValues} unique values mapped to IDs`);
  }
  if (valueResult.unresolvedValues.length > 0) {
    lines.push(`  ${YELLOW}Unresolved values:${RESET} ${valueResult.unresolvedValues.length}`);
  }

  // Unresolved columns
  if (unresolvedColumns.length > 0) {
    lines.push('');
    lines.push(`  ${RED}${BOLD}Needs LLM: ${unresolvedColumns.length} columns${RESET}`);
    for (const col of unresolvedColumns) {
      lines.push(`    ${RED}?${RESET} "${col}"`);
    }
  }

  lines.push('');
  if (fullyResolved) {
    lines.push(`  ${GREEN}${BOLD}All columns resolved — LLM call will be skipped${RESET}`);
  } else {
    lines.push(`  ${CYAN}LLM will handle ${unresolvedColumns.length} remaining column(s)${RESET}`);
  }

  return lines.join('\n');
}

/**
 * Renders a small confidence bar: [||||    ] style
 */
function confidenceBar(confidence: number): string {
  const filled = Math.round(confidence * 8);
  const empty = 8 - filled;
  return `[${'|'.repeat(filled)}${' '.repeat(empty)}]`;
}
