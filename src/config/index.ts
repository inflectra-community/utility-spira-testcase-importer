/**
 * Configuration loader and validator.
 * Loads configuration from CLI arguments with environment variable fallbacks,
 * validates using Zod schemas, and checks file path existence.
 */

import fs from 'node:fs';
import { ZodError } from 'zod';
import {
  ImporterConfigSchema,
  type ImporterConfig,
  type LLMConfig,
} from '../types/config.js';

/**
 * CLI arguments as parsed by Commander.js.
 * All fields are optional since environment variables can provide fallbacks.
 */
export interface CliArgs {
  spiraUrl?: string;
  username?: string;
  apiKey?: string;
  projectId?: number;
  provider?: 'openai' | 'anthropic' | 'bedrock';
  model?: string;
  llmApiKey?: string;
  region?: string;
  sourceFile?: string;
  dryRun?: boolean;
  logFile?: string;
  rootFolder?: string;
}

/**
 * Loads and validates importer configuration by merging CLI arguments
 * with environment variable fallbacks.
 *
 * Priority: CLI args > Environment variables
 *
 * Environment variable mappings:
 * - SPIRA_URL → spira.baseUrl
 * - SPIRA_USERNAME → spira.username
 * - SPIRA_API_KEY → spira.apiKey
 * - LLM_API_KEY → llm.apiKey
 * - AWS_REGION → llm.region
 * - SOURCE_PATH (fallback: SOURCE_FILE) → sourceFile
 */
export function loadConfig(cliArgs: CliArgs): ImporterConfig {
  const spira: Record<string, unknown> = {
    baseUrl: cliArgs.spiraUrl ?? process.env.SPIRA_URL,
    username: cliArgs.username ?? process.env.SPIRA_USERNAME,
    apiKey: cliArgs.apiKey ?? process.env.SPIRA_API_KEY,
    projectId: cliArgs.projectId ?? (process.env.SPIRA_PROJECT_ID ? parseInt(process.env.SPIRA_PROJECT_ID, 10) : undefined),
  };

  const llm: Record<string, unknown> = {
    provider: cliArgs.provider ?? process.env.LLM_PROVIDER,
    model: cliArgs.model ?? process.env.LLM_MODEL,
    apiKey: cliArgs.llmApiKey ?? process.env.LLM_API_KEY,
    region: cliArgs.region ?? process.env.AWS_REGION,
  };

  const rawConfig = {
    spira,
    llm,
    sourceFile: cliArgs.sourceFile ?? process.env.SOURCE_PATH ?? process.env.SOURCE_FILE,
    dryRun: cliArgs.dryRun ?? false,
    logFile: cliArgs.logFile,
    rootFolder: cliArgs.rootFolder ?? (process.env.ROOT_FOLDER || undefined),
  };

  // Validate with Zod schemas
  const parseResult = ImporterConfigSchema.safeParse(rawConfig);

  if (!parseResult.success) {
    throw new ConfigValidationError(formatZodError(parseResult.error));
  }

  const config = parseResult.data;

  // Validate source path exists on disk (file or directory for Zephyr bundles)
  if (!fs.existsSync(config.sourceFile)) {
    throw new ConfigValidationError(
      `Source path not found: "${config.sourceFile}". Please provide a valid path to an Excel file or Zephyr bundle directory.`
    );
  }

  // Validate LLM provider-specific requirements (only needed for Excel path, not Zephyr bundles)
  const stat = fs.statSync(config.sourceFile);
  if (!stat.isDirectory()) {
    validateLLMProviderConfig(config.llm);
  }

  return config;
}

/**
 * Validates that provider-specific fields are present.
 * - OpenAI/Anthropic require an apiKey
 * - Bedrock requires a region
 */
function validateLLMProviderConfig(llm: LLMConfig): void {
  if (!llm.provider) {
    throw new ConfigValidationError(
      `LLM provider is required for Excel imports. ` +
        `Set it via --provider or the LLM_PROVIDER environment variable.`
    );
  }

  if (!llm.model) {
    throw new ConfigValidationError(
      `LLM model is required for Excel imports. ` +
        `Set it via --model or the LLM_MODEL environment variable.`
    );
  }

  if ((llm.provider === 'openai' || llm.provider === 'anthropic') && !llm.apiKey) {
    throw new ConfigValidationError(
      `LLM API key is required for provider "${llm.provider}". ` +
        `Set it via --llm-api-key or the LLM_API_KEY environment variable.`
    );
  }

  if (llm.provider === 'bedrock' && !llm.region) {
    throw new ConfigValidationError(
      `AWS region is required for the "bedrock" provider. ` +
        `Set it via --region or the AWS_REGION environment variable.`
    );
  }
}

/**
 * Formats Zod validation errors into user-friendly messages.
 */
function formatZodError(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join('.');
    return `  - ${path ? path + ': ' : ''}${issue.message}`;
  });

  return `Configuration validation failed:\n${issues.join('\n')}`;
}

/**
 * Custom error class for configuration validation failures.
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}
