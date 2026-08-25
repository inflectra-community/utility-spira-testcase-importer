/**
 * Core Pipeline Types
 *
 * Defines the PipelineAdapter interface (the contract between headless core
 * and any frontend) plus stage result types used throughout the orchestrator.
 */

import type { ImporterConfig } from '../types/config.js';
import type { TemplateMetadata } from '../types/spira.js';
import type { SheetData } from '../parser/index.js';
import type { MappingResult, ValueSuggestion } from '../types/mapping.js';
import type { TransformedTestCase, TransformationResult } from '../types/transform.js';
import type { ImportResult } from '../types/import.js';
import type { PreAnalysisResult } from '../heuristics/index.js';
import type { ZephyrBundleResult } from '../parser/zephyr-bundle.js';

// ─── Stage Results ───────────────────────────────────────────────────────────

export interface ConnectResult {
  projectName: string;
  projectId: number;
  templateId: number;
}

export interface MetadataResult {
  metadata: TemplateMetadata;
  failures: { field: string; error: string }[];
}

export interface ParseResult {
  format: 'excel' | 'zephyr';
  /** Excel: available worksheets */
  sheets?: { name: string; rowCount: number; headers: string[] }[];
  /** Excel: the selected sheet data (after worksheet selection) */
  selectedSheet?: SheetData;
  /** Zephyr: the full bundle parse result */
  zephyrBundle?: ZephyrBundleResult;
}

export interface ZephyrResolveResult {
  testCases: TransformedTestCase[];
  warnings: string[];
}

export interface HeuristicResult {
  preAnalysis: PreAnalysisResult;
}

export interface MappingStageResult {
  mappingResult: MappingResult;
  /** True if heuristics resolved everything (no LLM was called) */
  heuristicsOnly: boolean;
}

export interface ValidationStageResult {
  transformResult: TransformationResult;
  report: string;
  stats: {
    totalTestCases: number;
    validTestCases: number;
    errorCount: number;
    warningCount: number;
  };
  isValid: boolean;
}

export interface ImportStageResult extends ImportResult {}

export interface AttachmentStageResult {
  successCount: number;
  skippedCount: number;
  failureCount: number;
}

// ─── Adapter Decisions ───────────────────────────────────────────────────────

export type MappingReviewDecision =
  | { action: 'accept' }
  | { action: 'editValues'; edits: ValueSuggestion[] }
  | { action: 'feedback'; feedback: string }
  | { action: 'exportProvisioner'; programName: string; productName: string }
  | { action: 'abort' };

export type ImportApprovalDecision =
  | { action: 'proceed' }
  | { action: 'revise'; feedback: string }
  | { action: 'abort' };

export type ZephyrApprovalDecision =
  | { action: 'proceed' }
  | { action: 'abort' };

// ─── Pipeline Adapter Interface ──────────────────────────────────────────────

/**
 * The adapter interface decouples pipeline orchestration from I/O.
 * Each method represents a point where the pipeline needs to display
 * information or collect a user decision.
 *
 * CLI adapter: inquirer prompts + ANSI terminal output.
 * Web adapter: returns data as JSON, collects decisions via HTTP.
 */
export interface PipelineAdapter {
  /** Display initial configuration summary */
  displayBanner(config: ImporterConfig): void;

  /** Display connection success info */
  onConnected(result: ConnectResult): void;

  /** Display metadata retrieval summary */
  onMetadataLoaded(metadata: TemplateMetadata): void;

  // ─── Excel path ─────────────────────────────────────────────────────────

  /** Select worksheet from multiple available sheets. Returns the sheet name. */
  selectWorksheet(sheets: { name: string; rowCount: number; headers: string[] }[]): Promise<string>;

  /** Display heuristic pre-analysis summary */
  onPreAnalysisComplete(preAnalysis: PreAnalysisResult): void;

  /** Display mapping result and collect user decision */
  reviewMapping(
    mappingResult: MappingResult,
    preAnalysis: PreAnalysisResult,
    metadata: TemplateMetadata,
  ): Promise<MappingReviewDecision>;

  /** Display provisioner export summary */
  onProvisionerExported(outputPath: string, newColumns: unknown[], missingValues: unknown[]): void;

  // ─── Zephyr path ────────────────────────────────────────────────────────

  /** Display Zephyr bundle parse summary */
  onZephyrParsed(bundle: ZephyrBundleResult, warnings: string[]): void;

  /** Collect approval to proceed with Zephyr import */
  approveZephyrImport(
    testCaseCount: number,
    validationErrors: number,
    isValid: boolean,
  ): Promise<ZephyrApprovalDecision>;

  // ─── Shared (both paths) ────────────────────────────────────────────────

  /** Display validation report and collect import approval */
  approveImport(
    report: string,
    stats: ValidationStageResult['stats'],
    isValid: boolean,
  ): Promise<ImportApprovalDecision>;

  /** Report import progress (called per test case) */
  onImportProgress(current: number, total: number, item: string): void;

  /** Display final import summary */
  onImportComplete(result: ImportResult, dryRun: boolean): void;

  /** Display attachment upload summary */
  onAttachmentsUploaded(result: AttachmentStageResult): void;

  /** Log an informational message */
  log(level: 'info' | 'warn' | 'error', message: string): void;
}
