"use client";

import { useAppStore } from "@/lib/store";
import type { ProviderConfig } from "@/types";

/**
 * Returns the first enabled and configured provider from the store.
 * Local providers (Ollama, LM Studio) don't need an API key.
 * Cloud providers need a non-empty apiKey.
 */
export function useActiveModel(): ProviderConfig | null {
  const providers = useAppStore((state) => state.providers);
  return (
    Object.values(providers).find(
      (p) => p.isEnabled && (p.isLocal || Boolean(p.apiKey))
    ) ?? null
  );
}
