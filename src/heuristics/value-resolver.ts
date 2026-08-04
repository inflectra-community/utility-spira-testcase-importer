/**
 * Value Resolver - resolves source spreadsheet values to Spira entity IDs.
 *
 * Strategies applied in priority order:
 * 1. Exact match (case-insensitive) - confidence 1.0
 * 2. Strip numeric prefix - confidence 0.95
 * 3. Source is substring of target - confidence 0.85
 * 4. Target is substring of source - confidence 0.8
 * 5. Levenshtein (normalised distance < 0.3) - confidence = 1 - distance
 */

import type { ValueResolutionResult, ValueResolverConfig, LookupEntry } from './types.js';
import { levenshteinSimilarity } from './string-similarity.js';

/** Regex to strip numeric prefix patterns like "2 - ", "3. ", "1) " */
const NUMERIC_PREFIX_RE = /^\d+\s*[-\u2013\u2014:.\)]\s*/;

/**
 * Resolves source values to Spira IDs for all mapped lookup columns.
 */
export function resolveValues(
  rows: Record<string, unknown>[],
  columnToField: Map<string, string>,
  config: ValueResolverConfig,
): ValueResolutionResult {
  const lookupMaps = new Map<string, Record<string, number>>();
  const unresolvedValues: { field: string; sourceValue: string }[] = [];
  const resolutionLog: { field: string; sourceValue: string; resolvedTo: string; resolvedId: number; confidence: number }[] = [];

  for (const [sourceColumn, targetField] of columnToField) {
    const entries = getLookupEntries(targetField, config);
    if (entries.length === 0) continue;

    // Collect unique non-empty values from this column
    const uniqueValues = new Set<string>();
    for (const row of rows) {
      const val = row[sourceColumn];
      if (val != null && String(val).trim() !== '') {
        uniqueValues.add(String(val).trim());
      }
    }

    // Resolve each unique value
    const fieldMap: Record<string, number> = {};
    for (const sourceValue of uniqueValues) {
      const match = resolveOneValue(sourceValue, entries);
      if (match) {
        fieldMap[sourceValue] = match.id;
        resolutionLog.push({
          field: targetField,
          sourceValue,
          resolvedTo: match.name,
          resolvedId: match.id,
          confidence: match.confidence,
        });
      } else {
        unresolvedValues.push({ field: targetField, sourceValue });
      }
    }

    if (Object.keys(fieldMap).length > 0) {
      lookupMaps.set(targetField, fieldMap);
    }
  }

  return { lookupMaps, unresolvedValues, resolutionLog };
}

/**
 * Returns the appropriate lookup entries for a given target field.
 */
function getLookupEntries(targetField: string, config: ValueResolverConfig): LookupEntry[] {
  switch (targetField) {
    case 'TestCasePriorityId': return config.priorities;
    case 'TestCaseStatusId': return config.statuses;
    case 'TestCaseTypeId': return config.types;
    case 'OwnerId': return config.users.map(u => ({ id: u.id, name: u.fullName }));
    case 'ComponentIds': return config.components;
    default:
      // Check custom property lists
      if (config.customPropertyListEntries?.has(targetField)) {
        return config.customPropertyListEntries.get(targetField)!;
      }
      return [];
  }
}

/**
 * Attempts to resolve a single source value against a list of lookup entries.
 */
function resolveOneValue(
  sourceValue: string,
  entries: LookupEntry[],
): { id: number; name: string; confidence: number } | null {
  const sourceLower = sourceValue.toLowerCase();

  // Strategy 1: Exact match (case-insensitive)
  for (const entry of entries) {
    if (!entry.name) continue;
    if (sourceLower === entry.name.toLowerCase()) {
      return { id: entry.id, name: entry.name, confidence: 1.0 };
    }
  }

  // Strategy 2: Strip numeric prefix from target, then match
  for (const entry of entries) {
    if (!entry.name) continue;
    const targetStripped = entry.name.replace(NUMERIC_PREFIX_RE, '').toLowerCase();
    if (targetStripped.length > 0 && sourceLower === targetStripped) {
      return { id: entry.id, name: entry.name, confidence: 0.95 };
    }
  }

  // Also strip prefix from source and match against raw target
  const sourceStripped = sourceValue.replace(NUMERIC_PREFIX_RE, '').toLowerCase().trim();
  if (sourceStripped !== sourceLower) {
    for (const entry of entries) {
      if (sourceStripped === entry.name.toLowerCase()) {
        return { id: entry.id, name: entry.name, confidence: 0.95 };
      }
      const targetStripped = entry.name.replace(NUMERIC_PREFIX_RE, '').toLowerCase();
      if (sourceStripped === targetStripped) {
        return { id: entry.id, name: entry.name, confidence: 0.95 };
      }
    }
  }

  // Strategy 3: Source is substring of target name
  for (const entry of entries) {
    if (!entry.name) continue;
    if (entry.name.toLowerCase().includes(sourceLower) && sourceLower.length >= 3) {
      return { id: entry.id, name: entry.name, confidence: 0.85 };
    }
  }

  // Strategy 4: Target name is substring of source
  for (const entry of entries) {
    if (!entry.name) continue;
    const entryLower = entry.name.toLowerCase();
    if (sourceLower.includes(entryLower) && entryLower.length >= 3) {
      return { id: entry.id, name: entry.name, confidence: 0.8 };
    }
    const strippedTarget = entry.name.replace(NUMERIC_PREFIX_RE, '').toLowerCase();
    if (strippedTarget.length >= 3 && sourceLower.includes(strippedTarget)) {
      return { id: entry.id, name: entry.name, confidence: 0.8 };
    }
  }

  // Strategy 5: Levenshtein distance
  let bestMatch: { id: number; name: string; confidence: number } | null = null;
  for (const entry of entries) {
    if (!entry.name) continue;
    const sim = levenshteinSimilarity(sourceLower, entry.name.toLowerCase());
    if (sim > 0.7 && (!bestMatch || sim > bestMatch.confidence)) {
      bestMatch = { id: entry.id, name: entry.name, confidence: sim };
    }
    const strippedTarget = entry.name.replace(NUMERIC_PREFIX_RE, '').toLowerCase();
    if (strippedTarget !== entry.name.toLowerCase()) {
      const simStripped = levenshteinSimilarity(sourceLower, strippedTarget);
      if (simStripped > 0.7 && (!bestMatch || simStripped > bestMatch.confidence)) {
        bestMatch = { id: entry.id, name: entry.name, confidence: simStripped };
      }
    }
  }

  return bestMatch;
}
