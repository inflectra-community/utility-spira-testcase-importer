/**
 * Configuration interfaces and Zod validation schemas for the importer tool.
 * Covers Spira connection settings, LLM provider configuration, and overall importer options.
 */

import { z } from 'zod';

// --- Zod Schemas ---

export const SpiraConfigSchema = z.object({
  baseUrl: z.url(),
  username: z.string().min(1, 'Username is required'),
  apiKey: z.string().min(1, 'API key is required'),
  projectId: z.number().int().positive('Project ID must be a positive integer'),
});

export const LLMConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'bedrock']),
  model: z.string().min(1, 'Model name is required'),
  apiKey: z.string().optional(),
  region: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const ImporterConfigSchema = z.object({
  spira: SpiraConfigSchema,
  llm: LLMConfigSchema,
  sourceFile: z.string().min(1, 'Source file path is required'),
  dryRun: z.boolean(),
  logFile: z.string().optional(),
});

// --- TypeScript Interfaces (inferred from schemas) ---

export type SpiraConfig = z.infer<typeof SpiraConfigSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type ImporterConfig = z.infer<typeof ImporterConfigSchema>;
