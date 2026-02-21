import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createAzure } from '@ai-sdk/azure';
import type { LanguageModelV3 } from '@ai-sdk/provider';

export type SupportedProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'together'
  | 'azure'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

/**
 * Creates a Vercel AI SDK LanguageModel for any supported provider.
 * All parameters are passed explicitly so this works in API routes
 * (server-side, no access to Zustand store).
 */
export function getModel(
  provider: string,
  modelId: string,
  apiKey: string,
  baseUrl?: string
): LanguageModelV3 {
  switch (provider) {
    case 'openai': {
      const client = createOpenAI({ apiKey, baseURL: baseUrl || undefined });
      return client(modelId);
    }

    case 'anthropic': {
      const client = createAnthropic({ apiKey, baseURL: baseUrl || undefined });
      return client(modelId);
    }

    case 'google': {
      const client = createGoogleGenerativeAI({ apiKey });
      return client(modelId);
    }

    case 'groq': {
      const client = createGroq({ apiKey });
      return client(modelId);
    }

    // OpenAI-compatible endpoints
    case 'together': {
      const client = createOpenAI({
        apiKey,
        baseURL: baseUrl || 'https://api.together.xyz/v1',
      });
      return client(modelId);
    }

    case 'openrouter': {
      const client = createOpenAI({
        apiKey,
        baseURL: baseUrl || 'https://openrouter.ai/api/v1',
        headers: {
          'HTTP-Referer': 'https://handai.app',
          'X-Title': 'Handai Data Suite',
        },
      });
      return client(modelId);
    }

    case 'ollama': {
      const client = createOpenAI({
        apiKey: apiKey || 'ollama',
        baseURL: baseUrl || 'http://localhost:11434/v1',
      });
      return client(modelId);
    }

    case 'lmstudio': {
      const client = createOpenAI({
        apiKey: apiKey || 'lm-studio',
        baseURL: baseUrl || 'http://localhost:1234/v1',
      });
      return client(modelId);
    }

    case 'custom': {
      if (!baseUrl) throw new Error('Custom provider requires a baseUrl');
      const client = createOpenAI({ apiKey, baseURL: baseUrl });
      return client(modelId);
    }

    case 'azure': {
      // baseUrl holds the Azure resource name for azure provider
      const client = createAzure({
        apiKey,
        resourceName: baseUrl || '',
      });
      return client(modelId);
    }

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
