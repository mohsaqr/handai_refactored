"use client";

import { useAppStore } from "@/lib/store";
import type { ProviderConfig, SystemSettings } from "@/types";

/**
 * Check whether a provider is fully configured and ready to use.
 * Local providers (Ollama, LM Studio) don't need an API key.
 * Cloud providers need a non-empty apiKey.
 */
function isProviderReady(p: ProviderConfig): boolean {
  return p.isEnabled && (p.isLocal === true || Boolean(p.apiKey));
}

/**
 * Returns the active provider.
 * If activeProviderId is set and that provider is still ready, return it.
 * Otherwise falls through to the first enabled+configured provider.
 */
export function useActiveModel(): ProviderConfig | null {
  const providers = useAppStore((state) => state.providers);
  const activeProviderId = useAppStore((state) => state.activeProviderId);

  if (activeProviderId) {
    const explicit = providers[activeProviderId];
    if (explicit && isProviderReady(explicit)) return explicit;
  }

  return Object.values(providers).find(isProviderReady) ?? null;
}

/**
 * Returns all enabled and configured providers (for dropdown lists).
 */
export function useConfiguredProviders(): ProviderConfig[] {
  const providers = useAppStore((state) => state.providers);
  return Object.values(providers).filter(isProviderReady);
}

/**
 * Returns the global system settings.
 */
export function useSystemSettings(): SystemSettings {
  return useAppStore((state) => state.systemSettings);
}
