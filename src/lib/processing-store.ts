/**
 * Global processing state store.
 *
 * Tracks which tools are actively processing so that:
 * 1. The sidebar can show processing indicators
 * 2. Processing survives navigation (component unmount)
 * 3. Users can navigate back and see progress/results
 *
 * useBatchProcessor writes full state here (progress, results, stats).
 * Custom-loop tools use setProcessingFlag() for sidebar indicators.
 */

import { create } from "zustand";

type Row = Record<string, unknown>;
type RunMode = "preview" | "test" | "full";

export interface ProcessingStats {
  success: number;
  errors: number;
  avgLatency: number;
}

export interface ProcessingJob {
  isProcessing: boolean;
  /** True between Stop click and in-flight rows finishing */
  aborting: boolean;
  runMode: RunMode;
  progress: { completed: number; total: number };
  results: Row[];
  stats: ProcessingStats | null;
  runId: string | null;
  startedAt: number;
  /** Generation counter — prevents stale loops from updating a superseded run */
  generation: number;
  /** Original row count for the run (e.g. 10 for test mode) — used by resume to stay in scope */
  originalRowCount: number | null;
}

// ── Abort flags (outside Zustand — non-serializable) ─────────────────────────

const abortFlags = new Map<string, boolean>();

export function getAbortFlag(toolId: string): boolean {
  return abortFlags.get(toolId) ?? false;
}

// ── Batched progress increments (avoids per-row Zustand writes) ──────────────

const pendingIncrements = new Map<string, number>();
let flushScheduled = false;

// ── Generation tracking (outside Zustand — checked synchronously) ────────────

const generations = new Map<string, number>();

export function currentGeneration(toolId: string): number {
  return generations.get(toolId) ?? 0;
}

// ── Store ────────────────────────────────────────────────────────────────────

interface ProcessingState {
  jobs: Record<string, ProcessingJob>;

  /** Start a new batch job — aborts any existing run for this tool.
   *  When resuming, pass initialCompleted to continue from where we left off. */
  startJob: (toolId: string, mode: RunMode, total: number, initialCompleted?: number, originalRowCount?: number) => number;

  /** Increment completed count by 1 */
  incrementProgress: (toolId: string) => void;

  /** Mark job done with final results */
  completeJob: (
    toolId: string,
    results: Row[],
    stats: ProcessingStats,
    runId: string | null
  ) => void;

  /** Remove job entirely (clears results) */
  clearJob: (toolId: string) => void;

  /** Set abort flag for a tool */
  requestAbort: (toolId: string) => void;

  /** For custom-loop tools — just toggle the processing flag for sidebar indicator */
  setProcessingFlag: (toolId: string, isProcessing: boolean) => void;
}

export const useProcessingStore = create<ProcessingState>((set) => ({
  jobs: {},

  startJob: (toolId, mode, total, initialCompleted, originalRowCount) => {
    // Abort any existing run
    abortFlags.set(toolId, false);
    const gen = (generations.get(toolId) ?? 0) + 1;
    generations.set(toolId, gen);

    // Preserve originalRowCount from a previous job when resuming (not passed)
    const prevOriginal = useProcessingStore.getState().jobs[toolId]?.originalRowCount ?? null;

    set((state) => ({
      jobs: {
        ...state.jobs,
        [toolId]: {
          isProcessing: true,
          aborting: false,
          runMode: mode,
          progress: { completed: initialCompleted ?? 0, total },
          results: [],
          stats: null,
          runId: null,
          startedAt: Date.now(),
          generation: gen,
          originalRowCount: originalRowCount ?? prevOriginal,
        },
      },
    }));

    return gen;
  },

  incrementProgress: (toolId) => {
    // Accumulate increments and flush on next animation frame to avoid
    // per-row Zustand writes (1000 rows = 1000 re-renders otherwise).
    pendingIncrements.set(toolId, (pendingIncrements.get(toolId) ?? 0) + 1);
    if (!flushScheduled) {
      flushScheduled = true;
      (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : setTimeout)(() => {
        flushScheduled = false;
        set((state) => {
          let jobs = state.jobs;
          for (const [id, count] of pendingIncrements) {
            const job = jobs[id];
            if (!job) continue;
            jobs = {
              ...jobs,
              [id]: {
                ...job,
                progress: { ...job.progress, completed: job.progress.completed + count },
              },
            };
          }
          pendingIncrements.clear();
          return { jobs };
        });
      });
    }
  },

  completeJob: (toolId, results, stats, runId) => {
    set((state) => {
      const existing = state.jobs[toolId];
      const total = existing?.progress?.total ?? 0;
      return {
        jobs: {
          ...state.jobs,
          [toolId]: {
            runMode: existing?.runMode ?? ("full" as RunMode),
            progress: { completed: total, total },
            startedAt: existing?.startedAt ?? 0,
            generation: existing?.generation ?? 0,
            originalRowCount: existing?.originalRowCount ?? null,
            isProcessing: false,
            aborting: false,
            results,
            stats,
            runId,
          },
        },
      };
    });
  },

  clearJob: (toolId) => {
    abortFlags.delete(toolId);
    generations.delete(toolId);
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [toolId]: _removed, ...rest } = state.jobs;
      return { jobs: rest };
    });
  },

  requestAbort: (toolId) => {
    abortFlags.set(toolId, true);
    set((state) => {
      const existing = state.jobs[toolId];
      if (!existing) return state;
      return {
        jobs: {
          ...state.jobs,
          [toolId]: { ...existing, aborting: true },
        },
      };
    });
  },

  setProcessingFlag: (toolId, isProcessing) => {
    set((state) => {
      const existing = state.jobs[toolId];
      if (existing) {
        return {
          jobs: {
            ...state.jobs,
            [toolId]: { ...existing, isProcessing },
          },
        };
      }
      if (!isProcessing) return state; // Don't create entry just to mark it idle
      return {
        jobs: {
          ...state.jobs,
          [toolId]: {
            isProcessing: true,
            aborting: false,
            runMode: "full" as RunMode,
            progress: { completed: 0, total: 0 },
            results: [],
            stats: null,
            runId: null,
            startedAt: Date.now(),
            generation: 0,
            originalRowCount: null,
          },
        },
      };
    });
  },
}));
