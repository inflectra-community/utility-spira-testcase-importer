/**
 * Data transformation interfaces representing the output of applying
 * a confirmed mapping to source Excel rows.
 */

export interface TransformedTestStep {
  description: string;
  expectedResult?: string;
  sampleData?: string;
  position: number;
}

export interface CustomPropertyValue {
  propertyNumber: number; // 1-30 (Spira's custom property slots)
  value: string | number | boolean | null;
}

export interface TransformedTestCase {
  sourceRowIndex: number; // For error tracing
  name: string;
  description?: string;
  testCasePriorityId?: number;
  testCaseStatusId?: number;
  testCaseTypeId?: number;
  ownerId?: number;
  componentIds?: number[];
  customProperties: CustomPropertyValue[];
  testSteps: TransformedTestStep[];
  folderPath?: string;
  tags?: string;
  /** Raw attachment cell value (ExcelJS hyperlink object or string) — for post-import upload */
  attachmentValue?: unknown;
}

export interface TransformationError {
  rowIndex: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export type TransformationWarning = TransformationError;

export interface TransformationResult {
  testCases: TransformedTestCase[];
  errors: TransformationError[];
  warnings: TransformationWarning[];
}
