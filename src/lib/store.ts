import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderConfig, SystemSettings } from '@/types';

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  temperature: 0,
  maxTokens: null,
  maxConcurrency: 5,
  autoRetry: true,
  autoSavePath: '',
};

interface AppState {
  providers: Record<string, ProviderConfig>;
  activeProviderId: string | null;
  systemSettings: SystemSettings;
  setProviderKey: (providerId: string, apiKey: string) => void;
  setProviderConfig: (providerId: string, config: Partial<ProviderConfig>) => void;
  setActiveProvider: (id: string | null) => void;
  setSystemSettings: (s: Partial<SystemSettings>) => void;
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
    defaultModel: 'llama3',
    isEnabled: false,
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
      activeProviderId: null,
      systemSettings: DEFAULT_SYSTEM_SETTINGS,
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
      setActiveProvider: (id) => set({ activeProviderId: id }),
      setSystemSettings: (s) =>
        set((state) => ({
          systemSettings: { ...state.systemSettings, ...s },
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
          activeProviderId: saved?.activeProviderId ?? null,
          systemSettings: {
            ...DEFAULT_SYSTEM_SETTINGS,
            ...(saved?.systemSettings ?? {}),
          },
        };
      },
    }
  )
);
