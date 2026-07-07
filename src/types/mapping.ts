/**
 * Mapping interfaces and Zod schemas for the LLM-generated field mapping
 * between source Excel columns and Spira target fields.
 */

import { z } from 'zod';

// --- Zod Schemas ---

export const FieldMappingSchema = z.object({
  sourceColumn: z.string(),
  targetField: z.string(),
  transformType: z.enum(['direct', 'lookup', 'template', 'ignore']),
  lookupMap: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  templatePattern: z.string().optional(),
});

export const TestStepMappingConfigSchema = z.object({
  mode: z.enum(['inline', 'separate-rows', 'none']),
  descriptionColumn: z.string().optional(),
  expectedResultColumn: z.string().optional(),
  sampleDataColumn: z.string().optional(),
  stepDelimiter: z.string().optional(),
});

export const FolderMappingConfigSchema = z.object({
  sourceColumn: z.string(),
  pathSeparator: z.string(),
});

export const MappingResultSchema = z.object({
  fieldMappings: z.array(FieldMappingSchema),
  testStepMapping: TestStepMappingConfigSchema.optional(),
  folderMapping: FolderMappingConfigSchema.optional(),
  confidence: z.number().min(0).max(1),
  unmappedSourceColumns: z.array(z.string()),
  unmappedTargetFields: z.array(z.string()),
  notes: z.array(z.string()),
});

// --- TypeScript Interfaces (inferred from schemas) ---

export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type TestStepMappingConfig = z.infer<typeof TestStepMappingConfigSchema>;
export type FolderMappingConfig = z.infer<typeof FolderMappingConfigSchema>;
export type MappingResult = z.infer<typeof MappingResultSchema>;
