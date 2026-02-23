/**
 * Tauri DB helpers — browser-side SQLite via @tauri-apps/plugin-sql.
 *
 * Each function mirrors the corresponding /api/* route response shape exactly,
 * so pages need minimal changes when branching on `isTauri`.
 *
 * The SQLite DB is initialised (migrations run) by tauri-plugin-sql on the Rust
 * side before the WebView loads. `Database.load()` opens the pooled connection.
 */

import Database from "@tauri-apps/plugin-sql";
import type { RunMeta } from "@/types";

const DB_PATH = "sqlite:handai.db";

let _db: Database | null = null;
async function getDb(): Promise<Database> {
  if (!_db) _db = await Database.load(DB_PATH);
  return _db;
}

// ── Run creation ───────────────────────────────────────────────────────────────

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
  const db = await getDb();

  // Create a session if one wasn't provided
  let sessionId = params.sessionId;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO sessions (id, name, mode, settingsJson) VALUES (?, ?, ?, ?)`,
      [sessionId, `Session ${new Date().toLocaleDateString()}`, params.runType ?? "full", "{}"]
    );
  }

  const runId = crypto.randomUUID();
  await db.execute(
    `INSERT INTO runs
       (id, sessionId, runType, provider, model, temperature, maxTokens,
        systemPrompt, schemaJson, variablesJson, inputFile, inputRows, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      sessionId,
      params.runType ?? "full",
      params.provider ?? "openai",
      params.model ?? "unknown",
      params.temperature ?? 0.7,
      params.maxTokens ?? 2048,
      params.systemPrompt ?? "",
      "{}",
      "{}",
      params.inputFile ?? "unnamed",
      params.inputRows ?? 0,
      "processing",
    ]
  );

  return { id: runId };
}

// ── List runs ──────────────────────────────────────────────────────────────────

export async function listRuns(
  limit = 50,
  offset = 0
): Promise<{ runs: RunMeta[]; total: number; limit: number; offset: number }> {
  const db = await getDb();

  const [rows, countRows] = await Promise.all([
    db.select<RunMeta[]>(
      `SELECT r.*,
              (SELECT COUNT(*) FROM run_results rr WHERE rr.runId = r.id) AS resultCount
       FROM runs r
       ORDER BY r.startedAt DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    ),
    db.select<[{ total: number }]>(`SELECT COUNT(*) AS total FROM runs`),
  ]);

  const total = countRows[0]?.total ?? 0;
  return { runs: rows, total, limit, offset };
}

// ── Get single run + results ───────────────────────────────────────────────────

export async function getRun(
  id: string
): Promise<{ run: RunMeta; results: unknown[] } | null> {
  const db = await getDb();

  const [runs, results] = await Promise.all([
    db.select<RunMeta[]>(`SELECT * FROM runs WHERE id = ?`, [id]),
    db.select<unknown[]>(
      `SELECT * FROM run_results WHERE runId = ? ORDER BY rowIndex ASC`,
      [id]
    ),
  ]);

  if (!runs.length) return null;
  return { run: runs[0], results };
}

// ── Delete run ────────────────────────────────────────────────────────────────

export async function deleteRun(id: string): Promise<{ ok: boolean }> {
  const db = await getDb();
  await db.execute(`DELETE FROM run_results WHERE runId = ?`, [id]);
  await db.execute(`DELETE FROM runs WHERE id = ?`, [id]);
  return { ok: true };
}

// ── Save batch results + mark run complete ─────────────────────────────────────

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
  const db = await getDb();

  for (const r of results) {
    await db.execute(
      `INSERT INTO run_results
         (id, runId, rowIndex, inputJson, output, status, errorType, errorMessage, latency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        runId,
        r.rowIndex,
        JSON.stringify(r.input),
        typeof r.output === "string" ? r.output : JSON.stringify(r.output),
        r.status ?? "success",
        r.errorType ?? null,
        r.errorMessage ?? null,
        r.latency ?? 0,
      ]
    );
  }

  const successCount = results.filter((r) => r.status !== "error").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const avgLatency =
    results.length > 0
      ? results.reduce((acc, r) => acc + (r.latency ?? 0), 0) / results.length
      : 0;

  await db.execute(
    `UPDATE runs SET status = ?, completedAt = datetime('now'), successCount = ?, errorCount = ?, avgLatency = ? WHERE id = ?`,
    ["completed", successCount, errorCount, avgLatency, runId]
  );

  return { count: results.length, success: true };
}
