import { useMemo, useRef } from "react";
import type { FileState } from "@/types";

export const fileKey = (f: File) => `${f.name}__${f.size}`;

export type FileResult = {
  status?: string;
  error_msg?: string;
  [k: string]: unknown;
};

/** Map File objects to FileStatus strings by combining the stored status on
 * each `FileState` with results emitted by `useBatchProcessor`. */
export function useFileStatuses(fileStates: FileState[], results: FileResult[]) {
  return useMemo(() => {
    if (results.length === 0) return fileStates.map((fs) => fs.status);
    return fileStates.map((_, i) => {
      const r = results[i];
      if (!r) return "pending" as const;
      if (r.status === "error") return "error" as const;
      if (r.status === "skipped") return "pending" as const;
      if (r.status === "success") return "done" as const;
      return "pending" as const;
    });
  }, [fileStates, results]);
}

/** Holds File objects in a ref keyed by `fileKey(file)`. File objects can't be
 * serialized, so anything relying on them must coordinate via this ref. */
export function useFilesRef() {
  return useRef<Map<string, File>>(new Map());
}
