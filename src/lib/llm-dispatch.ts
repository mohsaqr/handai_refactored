/**
 * Unified LLM dispatch layer — wraps static vs web branching into single functions.
 *
 * Each function handles static (browser-direct) vs web (fetch) transparently.
 * Error handling matches existing behavior:
 *   - dispatchCreateRun / dispatchSaveResults: never throw (log + return null/void)
 *   - dispatchProcessRow and others: throw on error (caller catches per-row)
 */

import {
  processRowDirect,
  generateRowDirect,
  comparisonRowDirect,
  consensusRowDirect,
  automatorRowDirect,
  documentExtractDirect,
  documentAnalyzeDirect,
  documentProcessDirect,
} from "./llm-browser";
import type { ConsensusResult } from "./llm-browser";
import { createRun as idbCreateRun, saveResults as idbSaveResults } from "./db-indexeddb";
import type { FieldDef } from "@/types";

// ── Runtime detection ────────────────────────────────────────────────────────

/** Static web build (GitHub Pages) — no server. Uses IndexedDB + browser-direct LLM. */
export const isStatic = process.env.NEXT_PUBLIC_STATIC === "1";

/**
 * True when the app should operate entirely in the browser:
 * - LLM calls go directly from the browser to provider APIs (no server relay)
 * - Run history is stored in IndexedDB (no server SQLite)
 *
 * Enabled for:
 * - Static builds (NEXT_PUBLIC_STATIC=1, e.g. GitHub Pages)
 * - Public server deployments (NEXT_PUBLIC_BROWSER_STORAGE=1)
 *
 * This ensures local models (LM Studio, Ollama) work from the user's machine,
 * and API keys never leave the browser.
 */
export const useBrowserStorage =
  isStatic || process.env.NEXT_PUBLIC_BROWSER_STORAGE === "1";

/** True when LLM calls should go through browser-direct path. */
const useBrowserDirect = useBrowserStorage;

// ── Result entry type ────────────────────────────────────────────────────────

export interface ResultEntry {
  rowIndex: number;
  input: Record<string, unknown>;
  output: string | Record<string, unknown>;
  status?: string;
  latency?: number;
  errorType?: string;
  errorMessage?: string;
}

// ── Run creation (never throws) ──────────────────────────────────────────────

export async function dispatchCreateRun(params: {
  runType: string;
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  inputFile?: string;
  inputRows?: number;
}): Promise<string | null> {
  try {
    if (useBrowserStorage) {
      const rd = await idbCreateRun(params);
      return rd.id ?? null;
    } else {
      const runRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!runRes.ok) {
        const errBody = await runRes.json().catch(() => ({}));
        throw new Error(errBody.error || `Server error ${runRes.status}`);
      }
      const rd = await runRes.json();
      return rd.id ?? null;
    }
  } catch (err) {
    console.warn("Run creation failed:", err);
    return null;
  }
}

// ── Results saving (never throws) ────────────────────────────────────────────

export async function dispatchSaveResults(
  runId: string,
  results: ResultEntry[]
): Promise<void> {
  try {
    if (useBrowserStorage) {
      await idbSaveResults(runId, results);
    } else {
      await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, results }),
      });
    }
  } catch (err) {
    console.warn("Run/results save failed:", err);
  }
}

// ── Single row processing (throws on error) ─────────────────────────────────
// Latency normalized to MILLISECONDS in both paths.

export async function dispatchProcessRow(params: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  systemPrompt: string;
  userContent: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ output: string; latency: number }> {
  if (useBrowserDirect) {
    const result = await processRowDirect(params);
    // Browser-direct returns latency in seconds — normalize to ms
    return { output: result.output, latency: Math.round(result.latency * 1000) };
  } else {
    const t0 = Date.now();
    const res = await fetch("/api/process-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error ${res.status}`);
    }
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return { output: json.output, latency: Date.now() - t0 };
  }
}

// ── Consensus row (throws on error) ──────────────────────────────────────────

export async function dispatchConsensusRow(params: {
  workers: Array<{
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  }>;
  judge: { provider: string; model: string; apiKey: string; baseUrl?: string };
  workerPrompt: string;
  judgePrompt: string;
  userContent: string;
  enableQualityScoring?: boolean;
  enableDisagreementAnalysis?: boolean;
  includeReasoning?: boolean;
  rowIdx?: number;
}): Promise<ConsensusResult> {
  if (useBrowserDirect) {
    return await consensusRowDirect(params);
  } else {
    const res = await fetch("/api/consensus-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error ${res.status}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}

// ── Comparison row (throws on error) ─────────────────────────────────────────

export async function dispatchComparisonRow(params: {
  models: Array<{
    id: string;
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  }>;
  systemPrompt: string;
  userContent: string;
  temperature?: number;
}): Promise<{
  results: Array<{
    id: string;
    output: string;
    latency?: number;
    success: boolean;
  }>;
}> {
  if (useBrowserDirect) {
    return await comparisonRowDirect(params);
  } else {
    const res = await fetch("/api/comparison-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}

// ── Automator row (throws on error) ──────────────────────────────────────────

export async function dispatchAutomatorRow(params: {
  row: Record<string, unknown>;
  steps: Array<{
    name: string;
    task: string;
    input_fields: string[];
    output_fields: Array<{ name: string; type: string; constraints?: string }>;
  }>;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<{
  output: Record<string, unknown>;
  stepResults: Array<{
    step: string;
    output?: unknown;
    raw?: string;
    success: boolean;
    error?: string;
  }>;
  success: boolean;
}> {
  if (useBrowserDirect) {
    return await automatorRowDirect(params);
  } else {
    const res = await fetch("/api/automator-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error ${res.status}`);
    }
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }
}

// ── Generate row (throws on error) ───────────────────────────────────────────

export async function dispatchGenerateRow(params: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  rowCount: number;
  columns?: Array<{ name: string; type: string; description?: string }>;
  freeformPrompt?: string;
  outputFormat?: string;
  temperature?: number;
  systemPrompt?: string;
}): Promise<{
  rows: Record<string, string>[];
  rawCsv: string;
  count: number;
  raw?: string;
}> {
  if (useBrowserDirect) {
    return await generateRowDirect(params);
  } else {
    const res = await fetch("/api/generate-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}

// ── Document extraction (throws on error) ────────────────────────────────────

export async function dispatchDocumentExtract(params: {
  file: File;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  systemPrompt?: string;
  fields?: FieldDef[];
}): Promise<{
  records: Record<string, unknown>[];
  fileName: string;
  charCount: number;
  truncated: boolean;
  count: number;
}> {
  if (useBrowserDirect) {
    return await documentExtractDirect(params);
  } else {
    // Extract text in browser (pdfjs-dist works in browser but fails server-side)
    const { extractTextBrowser } = await import("./document-browser");
    const { text: rawText } = await extractTextBrowser(params.file);
    const fileContent = btoa(unescape(encodeURIComponent(rawText)));

    const res = await fetch("/api/document-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileContent,
        fileType: "txt", // pre-extracted text, no server-side parsing needed
        fileName: params.file.name,
        provider: params.provider,
        model: params.model,
        apiKey: params.apiKey,
        baseUrl: params.baseUrl,
        systemPrompt: params.systemPrompt,
        fields: params.fields,
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error ${res.status}`);
    }
    return await res.json();
  }
}

// ── Document field analysis (throws on error) ────────────────────────────────

export async function dispatchDocumentAnalyze(params: {
  file: File;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  hint?: string;
}): Promise<{ fields: FieldDef[] }> {
  if (useBrowserDirect) {
    return await documentAnalyzeDirect(params);
  } else {
    // Extract text in browser (pdfjs-dist works in browser but fails server-side)
    const { extractTextBrowser } = await import("./document-browser");
    const { text: rawText } = await extractTextBrowser(params.file);
    const sampleText = rawText.slice(0, 3_000);
    const fileContent = btoa(unescape(encodeURIComponent(sampleText)));

    const res = await fetch("/api/document-analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileContent,
        fileType: "txt", // pre-extracted text, no server-side parsing needed
        fileName: params.file.name,
        provider: params.provider,
        model: params.model,
        apiKey: params.apiKey,
        baseUrl: params.baseUrl,
        hint: params.hint,
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error ${res.status}`);
    }
    return await res.json();
  }
}

// ── Document processing (throws on error) ───────────────────────────────────

export async function dispatchDocumentProcess(params: {
  file: File;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  systemPrompt: string;
}): Promise<{
  text: string;
  fileName: string;
  charCount: number;
  truncated: boolean;
}> {
  if (useBrowserDirect) {
    return await documentProcessDirect(params);
  } else {
    // Extract text in browser (pdfjs-dist works in browser but fails server-side)
    const { extractTextBrowser } = await import("./document-browser");
    const { text: rawText } = await extractTextBrowser(params.file);
    const fileContent = btoa(unescape(encodeURIComponent(rawText)));

    const res = await fetch("/api/document-process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileContent,
        fileType: "txt",
        fileName: params.file.name,
        provider: params.provider,
        model: params.model,
        apiKey: params.apiKey,
        baseUrl: params.baseUrl,
        systemPrompt: params.systemPrompt,
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error ${res.status}`);
    }
    return await res.json();
  }
}
