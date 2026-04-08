"use client";

import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

/**
 * Like useState, but persists the value to sessionStorage so it survives
 * navigation between tools. Reads in useEffect to avoid SSR/hydration
 * mismatches.
 *
 * The tricky part: on mount, two effects fire in the same commit.
 * The restore-effect reads from storage and calls setValue(stored), but
 * the save-effect still sees initialValue in its closure (the setValue
 * hasn't re-rendered yet). We must prevent the save-effect from writing
 * initialValue and overwriting storage.
 *
 * Solution: the restore-effect sets a "skip" ref. The save-effect checks
 * it and skips once (the mount commit), then clears it. On the next render
 * (with the restored value), the save-effect sees the stored value and
 * the skip flag is cleared, so subsequent user changes are saved normally.
 */
export function useSessionState<T>(
  key: string,
  initialValue: T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initialValue);

  // Number of save-effect runs to skip. Set by restore to prevent the
  // mount-commit save (which would write initialValue) and the
  // post-restore-render save (which would just re-write the stored value).
  const skipsRemaining = useRef(0);

  // Load from sessionStorage after mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null) {
        setValue(JSON.parse(saved) as T);
        // Skip 2 save-effect runs:
        //   1. The mount commit (value = initialValue in closure)
        //   2. The re-render after restore (value = stored, harmless but skip anyway)
        skipsRemaining.current = 2;
      }
    } catch { /* parse error — start fresh */ }
  }, [key]);

  // Save to sessionStorage on change
  useEffect(() => {
    if (skipsRemaining.current > 0) {
      skipsRemaining.current--;
      return;
    }
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch { /* quota exceeded — silently skip */ }
  }, [key, value]);

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
