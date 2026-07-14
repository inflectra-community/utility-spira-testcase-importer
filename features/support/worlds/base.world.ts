/**
 * Base World — shared interface that all layer-specific worlds implement.
 *
 * Each layer (logic, service, e2e) provides a World class that implements
 * these methods, allowing the same Gherkin step definitions to drive
 * different layers of the system.
 */

import { World } from '@cucumber/cucumber';
import type { MappingResult } from '../../../src/types/mapping.js';
import type { TransformedTestCase } from '../../../src/types/transform.js';
import type { ValidationResult } from '../../../src/types/validation.js';
import type { ImportResult } from '../../../src/types/import.js';
import type { TemplateMetadata } from '../../../src/types/spira.js';

export interface ImporterWorld extends World {
  // State holders
  templateMetadata: TemplateMetadata | null;
  sourceData: { headers: string[]; rows: Record<string, unknown>[] } | null;
  mappingResult: MappingResult | null;
  transformedTestCases: TransformedTestCase[] | null;
  validationResult: ValidationResult | null;
  importResult: ImportResult | null;
  error: Error | null;
  dryRun: boolean;

  // Actions — implementations vary by layer
  loadTemplateMetadata(projectId: number): Promise<void>;
  parseSpreadsheet(filePath: string): Promise<void>;
  performMapping(): Promise<void>;
  transformData(): Promise<void>;
  validateData(): Promise<void>;
  executeImport(): Promise<void>;
}
