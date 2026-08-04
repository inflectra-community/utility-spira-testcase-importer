/**
 * Types for the Heuristics Pre-Analysis Module.
 *
 * Defines the interfaces for column matching, value resolution,
 * structure detection, and the orchestrated pre-analysis result.
 */

import type { FieldDefinition, ArtifactMetadata } from '../types/strategy.js';
import type { SheetData } from '../parser/index.js';

// --- Column Matching ---

export interface ColumnMatch {
  sourceColumn: string;
  targetField: string;
  confidence: number;
  tier: 1 | 2 | 3;
  matchReason: string;
}

export interface ColumnMatchResult {
  matches: ColumnMatch[];
  unmatched: string[];
  ambiguous: { sourceColumn: string; candidates: ColumnMatch[] }[];
}

export interface ColumnMatcherConfig {
  fieldDefinitions: FieldDefinition[];
  customPropertyNames: string[];
}

// --- Value Resolution ---

export interface ValueMatch {
  sourceValue: string;
  targetId: number;
  targetName: string;
  confidence: number;
  matchReason: string;
}

export interface ValueResolutionResult {
  /** For each resolved field, a map of source value → Spira ID */
  lookupMaps: Map<string, Record<string, number>>;
  /** Values that couldn't be resolved */
  unresolvedValues: { field: string; sourceValue: string }[];
  /** Detailed log of resolutions */
  resolutionLog: { field: string; sourceValue: string; resolvedTo: string; resolvedId: number; confidence: number }[];
}

export interface LookupEntry {
  id: number;
  name: string;
}

export interface ValueResolverConfig {
  priorities: LookupEntry[];
  statuses: LookupEntry[];
  types: LookupEntry[];
  users: { id: number; fullName: string; userName: string }[];
  components: LookupEntry[];
  customLists: Map<number, LookupEntry[]>;
  /** Custom property list entries keyed by custom property name */
  customPropertyListEntries?: Map<string, LookupEntry[]>;
}

// --- Structure Detection ---

export interface StepStructure {
  mode: 'separate-rows' | 'inline' | 'none';
  confidence: number;
  /** For separate-rows mode */
  groupingColumn?: string;
  stepNumberColumn?: string;
  stepDescriptionColumn?: string;
  stepExpectedResultColumn?: string;
  /** For inline mode */
  inlineColumn?: string;
  inlineDelimiter?: 'numbered-dot' | 'step-prefix' | 'bullet' | 'semicolon' | 'newline';
}

export interface FolderStructure {
  detected: boolean;
  column?: string;
  separator?: string;
  confidence: number;
}

export interface StructureDetectionResult {
  stepStructure: StepStructure;
  folderStructure: FolderStructure;
}

// --- Pre-Analysis Orchestration ---

export interface PreAnalysisResult {
  /** Column mappings resolved by heuristics (Tier 1 and 2) */
  resolvedMappings: ColumnMatch[];
  /** Value lookup maps for resolved lookup fields */
  valueLookups: Map<string, Record<string, number>>;
  /** Detected spreadsheet structure */
  structure: StructureDetectionResult;
  /** Columns that need LLM assistance */
  unresolvedColumns: string[];
  /** Values that couldn't be matched */
  unresolvedValues: { field: string; sourceValue: string }[];
  /** Whether heuristics resolved everything (LLM can be skipped) */
  fullyResolved: boolean;
  /** Human-readable summary */
  summary: string;
}

export interface PreAnalysisConfig {
  fieldDefinitions: FieldDefinition[];
  metadata: ArtifactMetadata;
}
