"use client";

import { useState, useEffect, type Dispatch, type SetStateAction } from "react";

/**
 * Like useState, but persists the value to sessionStorage so it survives
 * navigation between tools. Reads after mount to avoid SSR/hydration
 * mismatches. Writes are gated on the hydrated flag so the mount commit
 * (which still has initialValue in closure) never clobbers stored data.
 */
export function useSessionState<T>(
  key: string,
  initialValue: T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from sessionStorage once on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null) setValue(JSON.parse(saved) as T);
    } catch { /* parse error — keep initialValue */ }
    setHydrated(true);
  }, [key]);

  // Save to sessionStorage on change — skipped until hydrated so the
  // mount commit can't overwrite storage with initialValue.
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch { /* quota exceeded — silently skip */ }
  }, [key, value, hydrated]);

  return [value, setValue];
}

/** Remove all sessionStorage keys that start with the given prefix. */
export function clearSessionKeys(prefix: string) {
  const toRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k?.startsWith(prefix)) toRemove.push(k);
  }
  toRemove.forEach((k) => sessionStorage.removeItem(k));
}
