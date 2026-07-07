/**
 * LLM provider factory that instantiates the correct Vercel AI SDK provider
 * based on the user's LLMConfig settings.
 */

import type { LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import type { LLMConfig } from '../types/config.js';

/**
 * Creates a LanguageModel instance from the Vercel AI SDK based on the
 * provider and model specified in the LLMConfig.
 *
 * @param config - The LLM configuration containing provider, model, and credentials
 * @returns A LanguageModel instance ready for use with `generateObject` or `generateText`
 * @throws Error if the provider is unsupported or required credentials are missing
 */
export function createLLMProvider(config: LLMConfig): LanguageModel {
  switch (config.provider) {
    case 'openai': {
      if (!config.apiKey) {
        throw new Error('OpenAI provider requires an API key. Provide it via --llm-api-key or LLM_API_KEY environment variable.');
      }
      const openai = createOpenAI({ apiKey: config.apiKey });
      return openai(config.model);
    }

    case 'anthropic': {
      if (!config.apiKey) {
        throw new Error('Anthropic provider requires an API key. Provide it via --llm-api-key or LLM_API_KEY environment variable.');
      }
      const anthropic = createAnthropic({ apiKey: config.apiKey });
      return anthropic(config.model);
    }

    case 'bedrock': {
      if (!config.region) {
        throw new Error('AWS Bedrock provider requires a region. Provide it via --region or AWS_REGION environment variable.');
      }
      const bedrock = createAmazonBedrock({ region: config.region });
      return bedrock(config.model);
    }

    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unsupported LLM provider: ${exhaustiveCheck}`);
    }
  }
}
