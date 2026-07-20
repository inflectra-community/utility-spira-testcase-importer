/**
 * Structure Detector — identifies spreadsheet layout patterns.
 *
 * Detects:
 * - Separate-rows test steps (rows grouped by parent ID, step numbers increment)
 * - Inline test steps (numbered lines, bullets, or delimiters within a single cell)
 * - Folder hierarchy columns (path separators, tree-like prefixes)
 */

import type { StepStructure, FolderStructure, StructureDetectionResult } from './types.js';

// --- Alias patterns for step-related columns ---

const STEP_NUMBER_PATTERNS = ['step #', 'step no', 'step number', 'step num', '#', 'no.', 'step', 'seq'];
const STEP_DESC_PATTERNS = ['step description', 'step desc', 'action', 'test step', 'step action', 'steps', 'step detail'];
const STEP_EXPECTED_PATTERNS = ['expected result', 'expected', 'expected outcome', 'verification', 'then', 'result'];

// --- Inline step recognizers ---

const NUMBERED_DOT_RE = /^\s*\d+[\.\)]\s+.+/m;
const STEP_PREFIX_RE = /^\s*Step\s+\d+\s*[:\-\u2013]\s*/im;
const BULLET_RE = /^\s*[\u2022\u25CF\u25CB\u25E6\-\*]\s+.+/m;

const PATH_SEPARATORS = ['/', '\\', '>', '\u2192', '::'];

/**
 * Detects structural patterns in the spreadsheet data.
 */
export function detectStructure(
  headers: string[],
  rows: Record<string, unknown>[],
  sampleSize: number = 10,
): StructureDetectionResult {
  const stepStructure = detectStepStructure(headers, rows, sampleSize);
  const folderStructure = detectFolderStructure(headers, rows);

  return { stepStructure, folderStructure };
}

// --- Separate-rows detection ---

function detectStepStructure(
  headers: string[],
  rows: Record<string, unknown>[],
  sampleSize: number,
): StepStructure {
  // Try separate-rows first (stronger signal)
  const separateRows = detectSeparateRows(headers, rows);
  if (separateRows.mode === 'separate-rows' && separateRows.confidence >= 0.7) {
    return separateRows;
  }

  // Try inline detection
  const inline = detectInlineSteps(headers, rows, sampleSize);
  if (inline.mode === 'inline' && inline.confidence >= 0.6) {
    return inline;
  }

  return { mode: 'none', confidence: 1.0 };
}

function detectSeparateRows(
  headers: string[],
  rows: Record<string, unknown>[],
): StepStructure {
  if (rows.length < 3) {
    return { mode: 'none', confidence: 0 };
  }

  // Step 1: Find candidate step number column
  // Look for a column that matches step number aliases AND contains sequential integers
  let stepNumberColumn: string | undefined;
  let stepNumberConfidence = 0;

  for (const header of headers) {
    const headerLower = header.toLowerCase().trim();

    // Check if column name matches step number patterns
    const nameMatch = STEP_NUMBER_PATTERNS.some(p =>
      headerLower === p || headerLower.includes(p),
    );

    if (!nameMatch) continue;

    // Verify it contains integers
    const values = rows.map(r => r[header]).filter(v => v != null);
    const intValues = values.filter(v => Number.isInteger(Number(v)));
    const intRatio = intValues.length / Math.max(values.length, 1);

    if (intRatio > 0.8) {
      stepNumberColumn = header;
      stepNumberConfidence = intRatio;
      break;
    }
  }

  // If no named step number column, look for any column with repeating sequences 1,2,3...
  if (!stepNumberColumn) {
    for (const header of headers) {
      const values = rows.map(r => r[header]).filter(v => v != null);
      const nums = values.map(v => Number(v)).filter(n => Number.isInteger(n) && n > 0);
      if (nums.length < rows.length * 0.8) continue;

      // Check if values contain sequences that reset (1,2,3,1,2,1,2,3,4...)
      let resets = 0;
      for (let i = 1; i < nums.length; i++) {
        if (nums[i] < nums[i - 1]) resets++;
      }

      if (resets > 0 && nums.includes(1)) {
        stepNumberColumn = header;
        stepNumberConfidence = 0.8;
        break;
      }
    }
  }

  if (!stepNumberColumn) {
    return { mode: 'none', confidence: 0 };
  }

  // Step 2: Find grouping column — a column where values repeat (uniqueRatio < 0.5)
  let groupingColumn: string | undefined;
  let bestRatio = 1.0;

  for (const header of headers) {
    if (header === stepNumberColumn) continue;

    const values = rows.map(r => r[header]).filter(v => v != null && String(v).trim() !== '');
    if (values.length === 0) continue;

    const unique = new Set(values.map(v => String(v).trim()));
    const ratio = unique.size / values.length;

    // Grouping columns have low unique ratio but aren't constant (ratio > 0)
    if (ratio < 0.5 && ratio > 0.01 && ratio < bestRatio) {
      bestRatio = ratio;
      groupingColumn = header;
    }
  }

  if (!groupingColumn) {
    return { mode: 'none', confidence: 0 };
  }

  // Step 3: Identify step description and expected result columns
  const stepDescriptionColumn = findColumnByPatterns(headers, STEP_DESC_PATTERNS, [stepNumberColumn, groupingColumn]);
  const stepExpectedResultColumn = findColumnByPatterns(headers, STEP_EXPECTED_PATTERNS, [stepNumberColumn, groupingColumn]);

  const confidence = Math.min(stepNumberConfidence, 0.9);

  return {
    mode: 'separate-rows',
    confidence,
    groupingColumn,
    stepNumberColumn,
    stepDescriptionColumn: stepDescriptionColumn ?? undefined,
    stepExpectedResultColumn: stepExpectedResultColumn ?? undefined,
  };
}

function findColumnByPatterns(
  headers: string[],
  patterns: string[],
  exclude: string[],
): string | null {
  for (const header of headers) {
    if (exclude.includes(header)) continue;
    const headerLower = header.toLowerCase().trim();
    for (const pattern of patterns) {
      if (headerLower === pattern || headerLower.includes(pattern)) {
        return header;
      }
    }
  }
  return null;
}

// --- Inline step detection ---

function detectInlineSteps(
  headers: string[],
  rows: Record<string, unknown>[],
  sampleSize: number,
): StepStructure {
  // Look for columns with long text that contain step patterns
  for (const header of headers) {
    const values = rows
      .map(r => r[header])
      .filter(v => v != null && typeof v === 'string' && v.length > 50)
      .slice(0, sampleSize) as string[];

    if (values.length < 3) continue;

    // Test each recognizer
    const result = detectInlinePattern(values);
    if (result) {
      return {
        mode: 'inline',
        confidence: result.confidence,
        inlineColumn: header,
        inlineDelimiter: result.delimiter,
      };
    }
  }

  return { mode: 'none', confidence: 0 };
}

function detectInlinePattern(
  samples: string[],
): { delimiter: StepStructure['inlineDelimiter']; confidence: number } | null {
  const checks: { re: RegExp; delimiter: StepStructure['inlineDelimiter'] }[] = [
    { re: NUMBERED_DOT_RE, delimiter: 'numbered-dot' },
    { re: STEP_PREFIX_RE, delimiter: 'step-prefix' },
    { re: BULLET_RE, delimiter: 'bullet' },
  ];

  for (const { re, delimiter } of checks) {
    const matchCount = samples.filter(s => re.test(s)).length;
    const ratio = matchCount / samples.length;
    if (ratio >= 0.6) {
      return { delimiter, confidence: ratio };
    }
  }

  // Semicolon check: split and see if we get 3+ segments consistently
  const semiMatches = samples.filter(s => {
    const parts = s.split(/;\s*/).filter(p => p.trim().length > 0);
    return parts.length >= 3;
  });
  if (semiMatches.length / samples.length >= 0.6) {
    return { delimiter: 'semicolon', confidence: semiMatches.length / samples.length };
  }

  return null;
}

// --- Folder detection ---

function detectFolderStructure(
  headers: string[],
  rows: Record<string, unknown>[],
): FolderStructure {
  let bestCandidate: FolderStructure = { detected: false, confidence: 0 };

  for (const header of headers) {
    const headerLower = header.toLowerCase().trim();

    // Bonus for name matching folder-like terms
    const nameBonus = ['folder', 'path', 'module', 'group', 'section', 'category'].some(
      term => headerLower.includes(term),
    ) ? 0.2 : 0;

    // Check values for separators
    const values = rows
      .map(r => r[header])
      .filter(v => v != null && String(v).trim() !== '')
      .map(v => String(v).trim());

    if (values.length < 3) continue;

    for (const sep of PATH_SEPARATORS) {
      const withSep = values.filter(v => v.includes(sep));
      const ratio = withSep.length / values.length;

      if (ratio > 0.3) {
        const confidence = Math.min(ratio + nameBonus, 1.0);
        if (confidence > bestCandidate.confidence) {
          bestCandidate = {
            detected: true,
            column: header,
            separator: sep,
            confidence,
          };
        }
      }
    }

    // Secondary: shared prefixes forming a tree (even without separators)
    if (!bestCandidate.detected && nameBonus > 0) {
      const prefixes = new Set(values.map(v => v.substring(0, Math.min(v.length, 10))));
      const prefixRatio = prefixes.size / values.length;
      // Low prefix diversity + folder-like name = likely folder column
      if (prefixRatio < 0.3) {
        const confidence = 0.6 + nameBonus;
        if (confidence > bestCandidate.confidence) {
          bestCandidate = { detected: true, column: header, separator: '/', confidence };
        }
      }
    }
  }

  return bestCandidate;
}
