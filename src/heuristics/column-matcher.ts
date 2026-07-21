/**
 * Column Matcher — matches source column headers to Spira field definitions.
 *
 * Strategies applied in priority order (first match wins):
 * 1. Exact match (case-insensitive) → confidence 1.0
 * 2. Known alias table → confidence 0.98
 * 3. Prefix/suffix strip → confidence 0.95
 * 4. Custom property name match → confidence 1.0
 * 5. Normalised Levenshtein (> 0.8) → confidence = similarity
 * 6. Contains match → confidence 0.75
 */

import type { ColumnMatch, ColumnMatchResult, ColumnMatcherConfig } from './types.js';
import { levenshteinSimilarity } from './string-similarity.js';

// --- Alias tables (extensible) ---

const FIELD_ALIASES: Record<string, string[]> = {
  'Name': ['name', 'title', 'test name', 'tc name', 'test case name', 'test case title', 'scenario', 'scenario name'],
  'Description': ['description', 'desc', 'details', 'summary', 'objective', 'purpose'],
  'TestCasePriorityId': ['priority', 'prio', 'importance', 'severity', 'criticality'],
  'TestCaseStatusId': ['status', 'state', 'workflow status', 'test status'],
  'TestCaseTypeId': ['type', 'test type', 'tc type', 'category', 'classification', 'test category'],
  'OwnerId': ['owner', 'assigned to', 'assignee', 'tester', 'responsible', 'assigned'],
  'ComponentIds': ['component', 'components', 'module', 'area', 'subsystem', 'feature area'],
  'Tags': ['tag', 'tags', 'label', 'labels', 'keyword', 'keywords'],
};

const FOLDER_ALIASES: string[] = [
  'folder', 'folder path', 'path', 'group', 'section', 'hierarchy', 'test folder',
];

/** Columns that should be auto-ignored (not mappable via the API). */
const IGNORE_PATTERNS: string[] = [
  'attachment', 'attachments', 'file', 'files', 'image', 'screenshot',
  'test step attachment', 'step attachment',
];

const STRIP_PATTERNS: RegExp[] = [
  /^test\s*case\s*/i,
  /^tc\s*/i,
  /^test\s*/i,
  /\s*id$/i,
  /\s*name$/i,
  /\s*field$/i,
];

/**
 * Matches source column headers to Spira field definitions.
 */
export function matchColumns(
  headers: string[],
  config: ColumnMatcherConfig,
): ColumnMatchResult {
  const matches: ColumnMatch[] = [];
  const unmatched: string[] = [];
  const ambiguous: { sourceColumn: string; candidates: ColumnMatch[] }[] = [];
  const fieldNames = config.fieldDefinitions.map(f => f.name);

  for (const header of headers) {
    if (!header || typeof header !== 'string' || header.trim() === '') {
      continue; // Skip null/undefined/empty headers
    }
    const candidates = findMatches(header, fieldNames, config.customPropertyNames);

    if (candidates.length === 0) {
      unmatched.push(header);
    } else if (candidates.length === 1) {
      matches.push(candidates[0]);
    } else {
      const sorted = candidates.sort((a, b) => b.confidence - a.confidence);
      const gap = sorted[0].confidence - sorted[1].confidence;
      if (gap >= 0.1) {
        matches.push(sorted[0]);
      } else {
        ambiguous.push({ sourceColumn: header, candidates: sorted });
      }
    }
  }

  return { matches, unmatched, ambiguous };
}

function findMatches(
  header: string,
  fieldNames: string[],
  customPropertyNames: string[],
): ColumnMatch[] {
  const candidates: ColumnMatch[] = [];
  const headerLower = header.toLowerCase().trim();

  // Strategy 0: Auto-ignore known unmappable columns
  if (IGNORE_PATTERNS.some(p => headerLower === p || headerLower.includes(p))) {
    return [{ sourceColumn: header, targetField: '__Ignore__', confidence: 1.0, tier: 1, matchReason: 'auto-ignore' }];
  }

  // Strategy 1: Exact match against field names
  for (const field of fieldNames) {
    if (headerLower === field.toLowerCase()) {
      return [{ sourceColumn: header, targetField: field, confidence: 1.0, tier: 1, matchReason: 'exact' }];
    }
  }

  // Strategy 2: Known alias table
  for (const [targetField, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(headerLower)) {
      return [{ sourceColumn: header, targetField, confidence: 0.98, tier: 1, matchReason: `alias` }];
    }
  }

  // Check folder aliases
  if (FOLDER_ALIASES.includes(headerLower)) {
    return [{ sourceColumn: header, targetField: '__FolderPath__', confidence: 0.98, tier: 1, matchReason: 'folder-alias' }];
  }

  // Strategy 3: Prefix/suffix strip then re-match
  let stripped = headerLower;
  for (const pattern of STRIP_PATTERNS) {
    stripped = stripped.replace(pattern, '').trim();
  }
  if (stripped !== headerLower && stripped.length > 0) {
    for (const field of fieldNames) {
      if (stripped === field.toLowerCase()) {
        return [{ sourceColumn: header, targetField: field, confidence: 0.95, tier: 1, matchReason: 'prefix-strip' }];
      }
    }
    for (const [targetField, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(stripped)) {
        return [{ sourceColumn: header, targetField, confidence: 0.95, tier: 1, matchReason: 'prefix-strip+alias' }];
      }
    }
  }

  // Strategy 4: Custom property name match (exact)
  for (const cpName of customPropertyNames) {
    if (!cpName) continue;
    if (headerLower === cpName.toLowerCase()) {
      return [{ sourceColumn: header, targetField: cpName, confidence: 1.0, tier: 1, matchReason: 'custom-property' }];
    }
  }

  // Strategy 4b: Custom property fuzzy/contains match
  for (const cpName of customPropertyNames) {
    if (!cpName) continue;
    const cpLower = cpName.toLowerCase();

    // Source is substring of custom property name (e.g., "Transaction" matches "Transaction Code")
    if (cpLower.includes(headerLower) && headerLower.length >= 3) {
      candidates.push({ sourceColumn: header, targetField: cpName, confidence: 0.9, tier: 2, matchReason: 'custom-property-contains' });
    }
    // Custom property name is substring of source
    if (headerLower.includes(cpLower) && cpLower.length >= 3) {
      candidates.push({ sourceColumn: header, targetField: cpName, confidence: 0.85, tier: 2, matchReason: 'custom-property-substring' });
    }
    // Levenshtein against custom property name
    const sim = levenshteinSimilarity(headerLower, cpLower);
    if (sim > 0.8) {
      candidates.push({ sourceColumn: header, targetField: cpName, confidence: sim, tier: 2, matchReason: `custom-property-fuzzy(${sim.toFixed(2)})` });
    }
  }
  if (candidates.length > 0) return candidates;

  // Strategy 5: Normalised Levenshtein (threshold > 0.8)
  for (const field of fieldNames) {
    const sim = levenshteinSimilarity(headerLower, field.toLowerCase());
    if (sim > 0.8) {
      candidates.push({ sourceColumn: header, targetField: field, confidence: sim, tier: 2, matchReason: `fuzzy(${sim.toFixed(2)})` });
    }
  }
  for (const [targetField, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const sim = levenshteinSimilarity(headerLower, alias);
      if (sim > 0.8) {
        candidates.push({ sourceColumn: header, targetField, confidence: sim, tier: 2, matchReason: `fuzzy-alias(${sim.toFixed(2)})` });
      }
    }
  }
  if (candidates.length > 0) return candidates;

  // Strategy 6: Contains match
  for (const [targetField, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      if (headerLower.includes(alias) || alias.includes(headerLower)) {
        candidates.push({ sourceColumn: header, targetField, confidence: 0.75, tier: 2, matchReason: 'contains' });
      }
    }
  }

  return candidates;
}
