/**
 * LLM Mapping Engine
 *
 * Implements the LLMMappingEngine interface that orchestrates LLM-assisted
 * mapping between source spreadsheet columns and Spira test case fields.
 *
 * Uses the Vercel AI SDK's `generateObject` for structured output constrained
 * to the MappingResult Zod schema, with exponential backoff retry for transient
 * LLM failures (rate limits, timeouts).
 */

import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import type { SheetData } from '../parser/index.js';
import type { TemplateMetadata } from '../types/spira.js';
import type { LLMConfig } from '../types/config.js';
import { MappingResultSchema, type MappingResult } from '../types/mapping.js';
import { buildMappingPrompt } from './prompt.js';
import { createLLMProvider } from './provider.js';

// --- Interfaces ---

export interface LLMMappingEngine {
  generateMapping(
    sourceData: SheetData,
    templateMetadata: TemplateMetadata,
    sampleRowCount?: number,
    preAnalysisContext?: string,
  ): Promise<MappingResult>;

  retryMapping(
    previousResult: MappingResult,
    userFeedback: string,
  ): Promise<MappingResult>;
}

// --- Error Classes ---

/**
 * Error thrown when the LLM provider returns a non-transient error
 * (e.g., invalid request, content policy violation, authentication failure).
 */
export class LLMProviderError extends Error {
  public readonly provider: string;
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;

  constructor(message: string, provider: string, statusCode?: number, isRetryable = false) {
    super(message);
    this.name = 'LLMProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
  }
}

/**
 * Error thrown when all retry attempts have been exhausted for a transient failure.
 */
export class LLMRetryExhaustedError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(attempts: number, lastError: Error) {
    super(
      `LLM request failed after ${attempts} attempts. Last error: ${lastError.message}`,
    );
    this.name = 'LLMRetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

// --- Constants ---

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const DEFAULT_SAMPLE_ROW_COUNT = 5;

// --- Helper Functions ---

/**
 * Determines whether an error is transient and should be retried.
 * Transient errors include rate limits (429) and timeouts.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Rate limit errors
    if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
      return true;
    }

    // Timeout errors
    if (message.includes('timeout') || message.includes('timed out') || message.includes('etimedout')) {
      return true;
    }

    // Network connectivity errors
    if (message.includes('econnreset') || message.includes('econnrefused') || message.includes('socket hang up')) {
      return true;
    }

    // Server errors (5xx)
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
      return true;
    }
  }

  // Check for status code on error objects
  if (error && typeof error === 'object') {
    const statusCode = (error as Record<string, unknown>).status ??
      (error as Record<string, unknown>).statusCode;
    if (typeof statusCode === 'number') {
      return statusCode === 429 || statusCode >= 500;
    }
  }

  return false;
}

/**
 * Calculates exponential backoff delay: baseDelay * 2^attempt
 * e.g., 1000ms, 2000ms, 4000ms for attempts 0, 1, 2
 */
export function calculateBackoffDelay(attempt: number, baseDelayMs: number = BASE_DELAY_MS): number {
  return baseDelayMs * Math.pow(2, attempt);
}

/**
 * Delays execution for the specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts a descriptive error message from an LLM provider error.
 */
function formatProviderError(error: unknown, provider: string): LLMProviderError {
  if (error instanceof LLMProviderError) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Authentication failures
    if (message.includes('401') || message.includes('unauthorized') || message.includes('invalid api key')) {
      return new LLMProviderError(
        `Authentication failed for ${provider} provider. Please verify your API key is correct and has not expired.`,
        provider,
        401,
        false,
      );
    }

    // Forbidden / access denied
    if (message.includes('403') || message.includes('forbidden') || message.includes('access denied')) {
      return new LLMProviderError(
        `Access denied by ${provider} provider. Your API key may not have permission to access the specified model.`,
        provider,
        403,
        false,
      );
    }

    // Rate limit
    if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
      return new LLMProviderError(
        `Rate limited by ${provider} provider. Too many requests — please wait before retrying.`,
        provider,
        429,
        true,
      );
    }

    // Model not found
    if (message.includes('404') || message.includes('not found')) {
      if (message.includes('model') || message.includes('not found')) {
        return new LLMProviderError(
          `Model not found on ${provider} provider. Please verify the model name is correct and available in your account.`,
          provider,
          404,
          false,
        );
      }
    }

    // Content policy
    if (message.includes('content') && (message.includes('policy') || message.includes('filter'))) {
      return new LLMProviderError(
        `Request blocked by ${provider} content policy. The prompt or response may contain disallowed content.`,
        provider,
        400,
        false,
      );
    }

    // Timeout
    if (message.includes('timeout') || message.includes('timed out')) {
      return new LLMProviderError(
        `Request to ${provider} timed out. The model may be overloaded or the request too large.`,
        provider,
        undefined,
        true,
      );
    }

    // Generic error with original message
    return new LLMProviderError(
      `${provider} provider error: ${error.message}`,
      provider,
      undefined,
      isTransientError(error),
    );
  }

  return new LLMProviderError(
    `Unknown error from ${provider} provider.`,
    provider,
    undefined,
    false,
  );
}

/**
 * Executes an async operation with exponential backoff retry for transient errors.
 * Retries up to MAX_RETRIES times with delays of 1s, 2s, 4s.
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  provider: string,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const providerError = formatProviderError(error, provider);

      if (!providerError.isRetryable || attempt === MAX_RETRIES) {
        // Non-retryable error or exhausted retries
        if (attempt === MAX_RETRIES && providerError.isRetryable) {
          throw new LLMRetryExhaustedError(attempt + 1, providerError);
        }
        throw providerError;
      }

      // Transient error — wait and retry
      lastError = providerError;
      const backoffMs = calculateBackoffDelay(attempt);
      await delay(backoffMs);
    }
  }

  // Should not reach here, but handle gracefully
  throw new LLMRetryExhaustedError(MAX_RETRIES + 1, lastError ?? new Error('Unknown error'));
}

// --- Engine Implementation ---

/**
 * Builds the retry prompt incorporating the previous mapping result and user feedback.
 */
function buildRetryPrompt(previousResult: MappingResult, userFeedback: string): string {
  const sections: string[] = [];

  sections.push('# Task: Revise Mapping Based on User Feedback');
  sections.push('');
  sections.push('You previously generated a mapping that the user has reviewed. They have provided feedback requesting changes.');
  sections.push('');
  sections.push('## Previous Mapping Result');
  sections.push('');
  sections.push('```json');
  sections.push(JSON.stringify(previousResult, null, 2));
  sections.push('```');
  sections.push('');
  sections.push('## User Feedback');
  sections.push('');
  sections.push(userFeedback);
  sections.push('');
  sections.push('## Instructions');
  sections.push('');
  sections.push('Please revise the mapping based on the user feedback above. Apply the requested changes while maintaining the overall structure and correctness of the mapping.');
  sections.push('Return the complete revised mapping result — not just the changed fields.');

  return sections.join('\n');
}

/**
 * Creates an LLMMappingEngine instance using the provided LLM configuration.
 *
 * @param config - LLM provider configuration (provider, model, API key, etc.)
 * @returns An LLMMappingEngine instance ready to generate and retry mappings
 */
export function createMappingEngine(config: LLMConfig): LLMMappingEngine {
  const model: LanguageModel = createLLMProvider(config);
  const providerName = config.provider;

  return {
    async generateMapping(
      sourceData: SheetData,
      templateMetadata: TemplateMetadata,
      sampleRowCount: number = DEFAULT_SAMPLE_ROW_COUNT,
      preAnalysisContext?: string,
    ): Promise<MappingResult> {
      // TODO: Token optimisation — consider skipping buildMappingPrompt entirely when
      // preAnalysisContext is comprehensive enough (requires stronger model or better schema hints)
      let prompt = buildMappingPrompt(sourceData, templateMetadata, sampleRowCount);
      if (preAnalysisContext) {
        prompt = preAnalysisContext + '\n\n' + prompt;
      }
      console.log(`[TOKEN] Total LLM prompt: ${prompt.length} chars (~${Math.ceil(prompt.length / 4)} tokens)`);

      return withRetry(async () => {
        const { object } = await generateObject({
          model,
          schema: MappingResultSchema,
          prompt,
        });

        return object;
      }, providerName);
    },

    async retryMapping(
      previousResult: MappingResult,
      userFeedback: string,
    ): Promise<MappingResult> {
      const prompt = buildRetryPrompt(previousResult, userFeedback);

      return withRetry(async () => {
        const { object } = await generateObject({
          model,
          schema: MappingResultSchema,
          prompt,
        });

        return object;
      }, providerName);
    },
  };
}
