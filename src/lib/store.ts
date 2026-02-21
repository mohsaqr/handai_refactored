import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderConfig } from '@/types';

interface AppState {
  providers: Record<string, ProviderConfig>;
  setProviderKey: (providerId: string, apiKey: string) => void;
  setProviderConfig: (providerId: string, config: Partial<ProviderConfig>) => void;
}

const DEFAULT_PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    providerId: 'openai',
    apiKey: '',
    defaultModel: 'gpt-4o',
    isEnabled: true,
  },
  anthropic: {
    providerId: 'anthropic',
    apiKey: '',
    defaultModel: 'claude-3-5-sonnet-20241022',
    isEnabled: true,
  },
  google: {
    providerId: 'google',
    apiKey: '',
    defaultModel: 'gemini-1.5-pro',
    isEnabled: true,
  },
  groq: {
    providerId: 'groq',
    apiKey: '',
    defaultModel: 'llama-3.3-70b-versatile',
    isEnabled: true,
  },
  together: {
    providerId: 'together',
    apiKey: '',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3-70b-chat-hf',
    isEnabled: false,
  },
  azure: {
    providerId: 'azure',
    apiKey: '',
    baseUrl: '',
    defaultModel: 'gpt-4o',
    isEnabled: false,
  },
  openrouter: {
    providerId: 'openrouter',
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    isEnabled: true,
  },
  ollama: {
    providerId: 'ollama',
    apiKey: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'gpt-oss:latest',
    isEnabled: true,
    isLocal: true,
  },
  lmstudio: {
    providerId: 'lmstudio',
    apiKey: 'lm-studio',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    isEnabled: false,
    isLocal: true,
  },
  custom: {
    providerId: 'custom',
    apiKey: '',
    baseUrl: '',
    defaultModel: '',
    isEnabled: false,
  },
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      providers: DEFAULT_PROVIDERS,
      setProviderKey: (providerId, apiKey) =>
        set((state) => ({
          providers: {
            ...state.providers,
            [providerId]: {
              ...(state.providers[providerId] || { providerId, defaultModel: '', isEnabled: true }),
              apiKey,
            },
          },
        })),
      setProviderConfig: (providerId, config) =>
        set((state) => ({
          providers: {
            ...state.providers,
            [providerId]: {
              ...state.providers[providerId],
              ...config,
            },
          },
        })),
    }),
    {
      name: 'handai-storage',
      // Merge saved state with defaults so new providers appear for existing users
      merge: (persisted: unknown, current: AppState): AppState => {
        const saved = persisted as Partial<AppState>;
        return {
          ...current,
          providers: {
            ...DEFAULT_PROVIDERS,
            ...(saved?.providers ?? {}),
          },
        };
      },
    }
  )
);
