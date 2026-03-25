/**
 * IndexedDB helpers for static web deployment (GitHub Pages).
 *
 * Mirrors the db-tauri.ts API exactly so llm-dispatch.ts can branch
 * transparently between Tauri, web server, and static web modes.
 *
 * Object stores: sessions, runs, runResults
 */

import type { RunMeta } from "@/types";

const DB_NAME = "handai";
const DB_VERSION = 1;

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      // Sessions store
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }

      // Runs store
      if (!db.objectStoreNames.contains("runs")) {
        const runStore = db.createObjectStore("runs", { keyPath: "id" });
        runStore.createIndex("sessionId", "sessionId", { unique: false });
        runStore.createIndex("startedAt", "startedAt", { unique: false });
      }

      // RunResults store
      if (!db.objectStoreNames.contains("runResults")) {
        const resStore = db.createObjectStore("runResults", { keyPath: "id" });
        resStore.createIndex("runId", "runId", { unique: false });
        resStore.createIndex("rowIndex", ["runId", "rowIndex"], { unique: false });
      }
    };

    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

// ── Helper: promisify IDBRequest ──────────────────────────────────────────────

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Run creation ──────────────────────────────────────────────────────────────

interface RunCreateParams {
  runType?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  inputFile?: string;
  inputRows?: number;
  sessionId?: string;
}

export async function createRun(params: RunCreateParams): Promise<{ id: string }> {
  const db = await openDb();

  let sessionId = params.sessionId;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").put({
      id: sessionId,
      name: `Session ${new Date().toLocaleDateString()}`,
      mode: params.runType ?? "full",
      settingsJson: "{}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await idbTx(tx);
  }

  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const run = {
    id: runId,
    sessionId,
    runType: params.runType ?? "full",
    provider: params.provider ?? "openai",
    model: params.model ?? "unknown",
    temperature: params.temperature ?? 0.7,
    maxTokens: params.maxTokens ?? 2048,
    systemPrompt: params.systemPrompt ?? "",
    schemaJson: "{}",
    variablesJson: "{}",
    inputFile: params.inputFile ?? "unnamed",
    inputRows: params.inputRows ?? 0,
    status: "processing",
    successCount: 0,
    errorCount: 0,
    retryCount: 0,
    avgLatency: 0,
    totalDuration: 0,
    jsonMode: false,
    maxConcurrency: 5,
    autoRetry: true,
    maxRetryAttempts: 3,
    runSettingsJson: "{}",
    startedAt: now,
    completedAt: null,
  };

  const tx = db.transaction("runs", "readwrite");
  tx.objectStore("runs").put(run);
  await idbTx(tx);

  return { id: runId };
}

// ── List runs ─────────────────────────────────────────────────────────────────

export async function listRuns(
  limit = 50,
  offset = 0
): Promise<{
  runs: RunMeta[];
  total: number;
  limit: number;
  offset: number;
  stats: { totalSessions: number; totalRuns: number; totalSuccess: number; totalError: number };
}> {
  const db = await openDb();

  // Get all runs, sort by startedAt DESC
  const allRuns: RunMeta[] = await idbReq(
    db.transaction("runs", "readonly").objectStore("runs").getAll()
  );
  allRuns.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

  const total = allRuns.length;
  const runs = allRuns.slice(offset, offset + limit);

  // Stats
  const sessionIds = new Set(allRuns.map((r) => r.sessionId));
  let totalSuccess = 0;
  let totalError = 0;
  for (const r of allRuns) {
    totalSuccess += r.successCount ?? 0;
    totalError += r.errorCount ?? 0;
  }

  return {
    runs,
    total,
    limit,
    offset,
    stats: {
      totalSessions: sessionIds.size,
      totalRuns: total,
      totalSuccess,
      totalError,
    },
  };
}

// ── Get single run + results ──────────────────────────────────────────────────

export async function getRun(
  id: string
): Promise<{ run: RunMeta; results: unknown[] } | null> {
  const db = await openDb();

  const run: RunMeta | undefined = await idbReq(
    db.transaction("runs", "readonly").objectStore("runs").get(id)
  );
  if (!run) return null;

  // Get results for this run via index
  const allResults: unknown[] = await new Promise((resolve, reject) => {
    const tx = db.transaction("runResults", "readonly");
    const idx = tx.objectStore("runResults").index("runId");
    const req = idx.getAll(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Sort by rowIndex
  (allResults as { rowIndex: number }[]).sort((a, b) => a.rowIndex - b.rowIndex);

  return { run, results: allResults };
}

// ── Delete run ────────────────────────────────────────────────────────────────

export async function deleteRun(id: string): Promise<{ ok: boolean }> {
  const db = await openDb();

  // Delete results first
  const results: { id: string }[] = await new Promise((resolve, reject) => {
    const tx = db.transaction("runResults", "readonly");
    const idx = tx.objectStore("runResults").index("runId");
    const req = idx.getAll(id);
    req.onsuccess = () => resolve(req.result as { id: string }[]);
    req.onerror = () => reject(req.error);
  });

  if (results.length > 0) {
    const tx = db.transaction("runResults", "readwrite");
    const store = tx.objectStore("runResults");
    for (const r of results) {
      store.delete(r.id);
    }
    await idbTx(tx);
  }

  // Delete the run
  const tx = db.transaction("runs", "readwrite");
  tx.objectStore("runs").delete(id);
  await idbTx(tx);

  return { ok: true };
}

// ── Save batch results + mark run complete ────────────────────────────────────

interface ResultEntry {
  rowIndex: number;
  input: Record<string, unknown>;
  output: string | Record<string, unknown>;
  status?: string;
  latency?: number;
  errorType?: string;
  errorMessage?: string;
}

export async function saveResults(
  runId: string,
  results: ResultEntry[]
): Promise<{ count: number; success: boolean }> {
  const db = await openDb();

  // Insert results
  const tx = db.transaction("runResults", "readwrite");
  const store = tx.objectStore("runResults");
  for (const r of results) {
    store.put({
      id: crypto.randomUUID(),
      runId,
      rowIndex: r.rowIndex,
      inputJson: JSON.stringify(r.input),
      output: typeof r.output === "string" ? r.output : JSON.stringify(r.output),
      status: r.status ?? "success",
      errorType: r.errorType ?? null,
      errorMessage: r.errorMessage ?? null,
      latency: r.latency ?? 0,
      retryAttempt: 0,
      createdAt: new Date().toISOString(),
    });
  }
  await idbTx(tx);

  // Update run stats
  const successCount = results.filter((r) => r.status !== "error").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const avgLatency =
    results.length > 0
      ? results.reduce((acc, r) => acc + (r.latency ?? 0), 0) / results.length
      : 0;

  const runTx = db.transaction("runs", "readwrite");
  const runStore = runTx.objectStore("runs");
  const run = await idbReq(runStore.get(runId));
  if (run) {
    run.status = "completed";
    run.completedAt = new Date().toISOString();
    run.successCount = successCount;
    run.errorCount = errorCount;
    run.avgLatency = avgLatency;
    runStore.put(run);
  }
  await idbTx(runTx);

  return { count: results.length, success: true };
}
