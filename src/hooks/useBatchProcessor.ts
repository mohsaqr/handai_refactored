"use client";

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import pLimit from "p-limit";
import { toast } from "sonner";
import {
  dispatchCreateRun,
  dispatchSaveResults,
  type ResultEntry,
} from "@/lib/llm-dispatch";
import {
  useProcessingStore,
  getAbortFlag,
  currentGeneration,
} from "@/lib/processing-store";
import type { ProviderConfig, SystemSettings } from "@/types";

type Row = Record<string, unknown>;
type RunMode = "preview" | "test" | "full";

interface Stats {
  success: number;
  errors: number;
  avgLatency: number;
}

export interface BatchProcessorConfig {
  /** Route path used as job key (e.g. "/transform"). Required for cross-navigation persistence. */
  toolId: string;
  runType: string;
  activeModel: ProviderConfig | null;
  systemSettings: SystemSettings;
  data: Row[];
  dataName: string;
  systemPrompt: string;
  processRow: (row: Row, index: number) => Promise<Row>;
  buildResultEntry?: (row: Row, index: number) => ResultEntry;
  validate?: () => string | null;
  selectData?: (data: Row[], mode: RunMode) => Row[];
  runParams?: Partial<{
    provider: string;
    model: string;
    temperature: number;
  }>;
  onComplete?: (results: Row[], stats: Stats) => void;
  concurrency?: number;
}

export interface BatchProcessorReturn {
  isProcessing: boolean;
  /** True between Stop click and in-flight rows finishing */
  aborting: boolean;
  runMode: RunMode;
  progress: { completed: number; total: number };
  results: Row[];
  stats: Stats | null;
  runId: string | null;
  progressPct: number;
  etaStr: string;
  failedCount: number;
  /** Number of rows skipped due to Stop */
  skippedCount: number;
  run: (mode: RunMode) => Promise<void>;
  resume: () => Promise<void>;
  abort: () => void;
  clearResults: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module-level processing runner — lives outside React, survives navigation.
// The hook only LAUNCHES jobs and READS state; it never owns the processing loop.
// ═══════════════════════════════════════════════════════════════════════════════

/** Active promises keyed by toolId — prevents duplicate launches and holds a strong reference. */
const activeJobs = new Map<string, Promise<{ mergedResults: Row[]; computedStats: Stats } | undefined>>();

interface ProcessRowsParams {
  toolId: string;
  mode: RunMode;
  targetData: Row[];
  indicesToProcess: number[];
  baseResults: Row[];
  runType: string;
  activeModel: ProviderConfig;
  systemSettings: SystemSettings;
  dataName: string;
  systemPrompt: string;
  processRow: (row: Row, index: number) => Promise<Row>;
  buildResultEntry?: (row: Row, index: number) => ResultEntry;
  runParams?: Partial<{ provider: string; model: string; temperature: number }>;
  concurrency: number;
  /** For resume: total row count of the full dataset (not just retried rows). */
  fullTotal?: number;
  /** For resume: number of rows already completed before this run. */
  initialCompleted?: number;
}

/** Runs the processing loop entirely outside React. Updates only the Zustand store. */
async function executeProcessing(params: ProcessRowsParams) {
  const {
    toolId, mode, targetData, indicesToProcess, baseResults,
    runType, activeModel, systemSettings, dataName, systemPrompt,
    processRow, buildResultEntry, runParams, concurrency,
    fullTotal, initialCompleted,
  } = params;

  const store = useProcessingStore.getState();
  const progressTotal = fullTotal ?? indicesToProcess.length;
  const gen = store.startJob(toolId, mode, progressTotal, initialCompleted, fullTotal == null ? targetData.length : undefined);

  const localRunId = await dispatchCreateRun({
    runType,
    provider: runParams?.provider ?? activeModel.providerId,
    model: runParams?.model ?? activeModel.defaultModel,
    temperature: runParams?.temperature ?? systemSettings.temperature,
    systemPrompt,
    inputFile: dataName || "unnamed",
    inputRows: indicesToProcess.length,
  });

  const limit = pLimit(concurrency);
  const mergedResults: Row[] = [...baseResults];
  const latencies: number[] = [];

  const tasks = indicesToProcess.map((originalIdx) =>
    limit(async () => {
      if (getAbortFlag(toolId) || currentGeneration(toolId) !== gen) {
        // Mark skipped rows so Resume can pick them up
        mergedResults[originalIdx] = {
          ...targetData[originalIdx],
          status: "skipped",
        };
        return;
      }
      const row = targetData[originalIdx];
      try {
        const processedRow = await processRow(row, originalIdx);
        mergedResults[originalIdx] = processedRow;
        const lat = processedRow.latency_ms as number | undefined;
        if (lat !== undefined) latencies.push(lat);
      } catch (err) {
        mergedResults[originalIdx] = {
          ...row,
          status: "error",
          error_msg: String(err),
        };
      }
      if (currentGeneration(toolId) === gen) {
        useProcessingStore.getState().incrementProgress(toolId);
      }
    })
  );

  await Promise.all(tasks);

  if (currentGeneration(toolId) !== gen) return undefined;

  const errors = mergedResults.filter((r) => r.status === "error").length;
  const avgLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;
  const computedStats: Stats = {
    success: mergedResults.length - errors,
    errors,
    avgLatency,
  };

  if (localRunId) {
    const resultRows: ResultEntry[] = buildResultEntry
      ? mergedResults.map((r, i) => buildResultEntry(r, i))
      : mergedResults.map((r, i) => ({
          rowIndex: i,
          input: r as Record<string, unknown>,
          output:
            (r.ai_output as string) ??
            (r.ai_code as string) ??
            JSON.stringify(r),
          status: (r.status as string) ?? "success",
          latency: r.latency_ms as number | undefined,
          errorMessage: r.error_msg as string | undefined,
        }));
    await dispatchSaveResults(localRunId, resultRows);
  }

  useProcessingStore.getState().completeJob(toolId, mergedResults, computedStats, localRunId);
  return { mergedResults, computedStats };
}

/** Launch processing and keep a strong reference in the module-level map. */
function launchProcessing(params: ProcessRowsParams): Promise<{ mergedResults: Row[]; computedStats: Stats } | undefined> {
  const { toolId } = params;
  const promise = executeProcessing(params).catch((err) => {
    // If executeProcessing throws before completeJob, reset isProcessing
    const job = useProcessingStore.getState().jobs[toolId];
    if (job?.isProcessing) {
      useProcessingStore.getState().completeJob(toolId, job.results ?? [], { success: 0, errors: 0, avgLatency: 0 }, job.runId ?? null);
    }
    console.error("Batch processing error:", err);
    return undefined;
  }).finally(() => {
    activeJobs.delete(toolId);
  });
  activeJobs.set(toolId, promise);
  return promise;
}

// ═══════════════════════════════════════════════════════════════════════════════
// React hook — thin wrapper that launches jobs and reads from the store
// ═══════════════════════════════════════════════════════════════════════════════

// Stable references for default selector values (avoids new object per render)
const defaultProgress = { completed: 0, total: 0 };
const emptyResults: Row[] = [];

export function useBatchProcessor(
  config: BatchProcessorConfig
): BatchProcessorReturn {
  const { toolId } = config;

  // Keep latest config in a ref so callbacks are stable across renders
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; });

  // Fine-grained selectors — progress changes don't trigger results re-computation
  const isProcessing = useProcessingStore((s) => s.jobs[toolId]?.isProcessing ?? false);
  const aborting = useProcessingStore((s) => s.jobs[toolId]?.aborting ?? false);
  const runMode = useProcessingStore((s) => s.jobs[toolId]?.runMode ?? "full");
  const progress = useProcessingStore((s) => s.jobs[toolId]?.progress ?? defaultProgress);
  const results = useProcessingStore((s) => s.jobs[toolId]?.results ?? emptyResults);
  const stats = useProcessingStore((s) => s.jobs[toolId]?.stats ?? null);
  const runId = useProcessingStore((s) => s.jobs[toolId]?.runId ?? null);
  const startedAt = useProcessingStore((s) => s.jobs[toolId]?.startedAt ?? 0);
  const requestAbort = useProcessingStore((s) => s.requestAbort);
  const clearJob = useProcessingStore((s) => s.clearJob);

  const failedCount = useMemo(
    () => results.filter((r) => r.status === "error").length,
    [results]
  );

  const skippedCount = useMemo(
    () => results.filter((r) => r.status === "skipped").length,
    [results]
  );

  const progressPct =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  const [etaStr, setEtaStr] = useState("");

  useEffect(() => {
    if (!isProcessing || startedAt === 0) { queueMicrotask(() => setEtaStr("")); return; }
    const update = () => {
      const j = useProcessingStore.getState().jobs[toolId];
      const completed = j?.progress.completed ?? 0;
      const total = j?.progress.total ?? 0;
      if (completed === 0) { setEtaStr(""); return; }
      const elapsedMs = Date.now() - startedAt;
      const etaMs = (elapsedMs / completed) * (total - completed);
      if (etaMs > 5000) {
        setEtaStr(etaMs < 60000 ? `~${Math.round(etaMs / 1000)}s left` : `~${Math.floor(etaMs / 60000)}m left`);
      } else {
        setEtaStr("");
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [isProcessing, startedAt, toolId]);

  const abort = useCallback(() => {
    requestAbort(toolId);
  }, [toolId, requestAbort]);

  const clearResults = useCallback(() => {
    clearJob(toolId);
  }, [toolId, clearJob]);

  // ── run: validate in React, then hand off to module-level runner ─────────

  const run = useCallback(
    async (mode: RunMode) => {
      const cfg = configRef.current;
      const {
        activeModel, data, validate, selectData, onComplete,
        runType, systemSettings, dataName, systemPrompt,
        processRow, buildResultEntry, runParams, concurrency,
      } = cfg;

      if (data.length === 0) { toast.error("No data loaded"); return; }
      if (!activeModel) { toast.error("No model configured. Go to Settings."); return; }
      if (validate) {
        const errMsg = validate();
        if (errMsg) { toast.error(errMsg); return; }
      }

      let targetData: Row[];
      if (selectData) {
        targetData = selectData(data, mode);
      } else {
        targetData =
          mode === "preview" ? data.slice(0, 3)
            : mode === "test" ? data.slice(0, 10)
              : data;
      }
      if (targetData.length === 0) { toast.error("No rows to process"); return; }

      const allIndices = targetData.map((_, i) => i);

      const outcome = await launchProcessing({
        toolId, mode, targetData, indicesToProcess: allIndices,
        baseResults: [...targetData],
        runType, activeModel, systemSettings, dataName, systemPrompt,
        processRow, buildResultEntry, runParams,
        concurrency: concurrency ?? systemSettings.maxConcurrency,
      });

      if (!outcome) return;
      const { mergedResults, computedStats } = outcome;
      const skipped = mergedResults.filter((r) => r.status === "skipped").length;
      if (skipped > 0) {
        toast.info(`Stopped — ${mergedResults.length - skipped - computedStats.errors} of ${mergedResults.length} completed`);
      } else if (computedStats.errors > 0) {
        toast.warning(`Done — ${computedStats.errors} rows had errors`);
      } else {
        toast.success(
          mode === "full"
            ? "Processing complete!"
            : `${mode === "preview" ? "Preview" : "Test"} complete (${targetData.length} rows)`
        );
      }
      onComplete?.(mergedResults, computedStats);
    },
    [toolId]
  );

  const resume = useCallback(
    async () => {
      const cfg = configRef.current;
      const {
        activeModel, data, onComplete,
        runType, systemSettings, dataName, systemPrompt,
        processRow, buildResultEntry, runParams, concurrency,
      } = cfg;

      if (data.length === 0) { toast.error("No data loaded"); return; }
      if (!activeModel) { toast.error("No model configured. Go to Settings."); return; }

      const job = useProcessingStore.getState().jobs[toolId];
      const existingResults = job?.results ?? [];
      const originalMode = job?.runMode ?? "full";
      // Scope resume to the original row count (e.g. 10 for test mode)
      const scopeCount = job?.originalRowCount ?? data.length;
      const scopedData = data.slice(0, scopeCount);

      const retryIndices: number[] = [];
      for (let i = 0; i < scopedData.length; i++) {
        const existing = existingResults[i];
        if (!existing || existing.status === "error" || existing.status === "skipped") retryIndices.push(i);
      }
      if (retryIndices.length === 0) { toast.info("No incomplete rows to retry"); return; }

      const baseResults: Row[] = scopedData.map((row, i) =>
        existingResults[i] && existingResults[i].status !== "error" && existingResults[i].status !== "skipped" ? existingResults[i] : row
      );

      const alreadyCompleted = scopedData.length - retryIndices.length;
      const outcome = await launchProcessing({
        toolId, mode: originalMode, targetData: scopedData, indicesToProcess: retryIndices,
        baseResults,
        runType, activeModel, systemSettings, dataName, systemPrompt,
        processRow, buildResultEntry, runParams,
        concurrency: concurrency ?? systemSettings.maxConcurrency,
        fullTotal: scopedData.length,
        initialCompleted: alreadyCompleted,
      });

      if (!outcome) return;
      const { mergedResults, computedStats } = outcome;
      const retried = retryIndices.length;
      if (computedStats.errors > 0) {
        toast.warning(`Resumed ${retried} rows — ${computedStats.errors} still have errors`);
      } else {
        toast.success(`Resumed ${retried} rows — all successful now`);
      }
      onComplete?.(mergedResults, computedStats);
    },
    [toolId]
  );

  return {
    isProcessing, aborting, runMode, progress, results, stats, runId,
    progressPct, etaStr, failedCount, skippedCount,
    run, resume, abort, clearResults,
  };
}
