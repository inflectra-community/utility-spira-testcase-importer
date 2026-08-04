/**
 * Validation interfaces for the validation engine that checks
 * transformed test cases against Spira schema constraints.
 */

export interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  stats: {
    totalTestCases: number;
    validTestCases: number;
    totalTestSteps: number;
    errorCount: number;
    warningCount: number;
  };
}
