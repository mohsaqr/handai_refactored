"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { DataTable, ExportDropdown } from "@/components/tools/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PromptEditor } from "@/components/tools/PromptEditor";
import { useActiveModel } from "@/lib/hooks";
import { useRestoreSession } from "@/hooks/useRestoreSession";
import { useProcessingStore, getAbortFlag, currentGeneration } from "@/lib/processing-store";
import { Sparkles, Plus, Trash2, Download, Loader2, Minus, ExternalLink, Check, X, RotateCcw, ArrowUp, ArrowDown, Upload, ClipboardPaste, Pencil, Play } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type { GenerateColumn, Row } from "@/types";
import { dispatchGenerateRow, dispatchProcessRow, dispatchCreateRun, dispatchSaveResults } from "@/lib/llm-dispatch";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { getPrompt } from "@/lib/prompts";
import { FileUploader } from "@/components/tools/FileUploader";
import { SingleRunButton } from "@/components/tools/SingleRunButton";
import { Textarea } from "@/components/ui/textarea";
import Papa from "papaparse";
import * as XLSX from "xlsx";
// ─── Types ──────────────────────────────────────────────────────────────────

interface SuggestedField {
  name: string;
  type: "text" | "number";
  description: string;
}

// ─── Sample prompts ──────────────────────────────────────────────────────────
const SAMPLE_PROMPTS: Record<string, string> = {
  "Customer reviews": "Generate realistic customer product reviews including reviewer name, rating (1-5), review title, review body, product category, and whether the review was verified purchase.",
  "Job postings": "Generate realistic job postings with company name, job title, location, salary range, required experience (years), required skills, and job description.",
  "Survey responses": "Generate realistic employee engagement survey responses with respondent ID, department, tenure (years), satisfaction score (1-10), and open-ended feedback about workplace culture.",
  "Support tickets": "Generate realistic customer support tickets with ticket ID, customer name, issue category, priority (Low/Medium/High/Critical), issue description, and current status.",
  "Research interviews": "Generate realistic qualitative research interview excerpts with participant ID, age group, occupation, interview question, and participant response.",
  "Student feedback": "Generate student feedback on online courses with student ID, course name, completion status, rating (1-5), what they liked, and what could be improved.",
};

const SAMPLE_COLUMNS: Record<string, SuggestedField[]> = {
  "Customer reviews": [
    { name: "reviewer_name", type: "text", description: "Full name of the reviewer" },
    { name: "rating", type: "number", description: "Rating from 1 to 5" },
    { name: "review_title", type: "text", description: "Title of the review" },
    { name: "review_body", type: "text", description: "Full review text" },
    { name: "product_category", type: "text", description: "Product category" },
    { name: "verified_purchase", type: "text", description: "Yes or No" },
  ],
  "Job postings": [
    { name: "company_name", type: "text", description: "Name of the company" },
    { name: "job_title", type: "text", description: "Job title" },
    { name: "location", type: "text", description: "Job location" },
    { name: "salary_range", type: "text", description: "Salary range" },
    { name: "experience_years", type: "number", description: "Required years of experience" },
    { name: "required_skills", type: "text", description: "Comma-separated skills" },
    { name: "job_description", type: "text", description: "Full job description" },
  ],
  "Survey responses": [
    { name: "respondent_id", type: "text", description: "Unique respondent identifier" },
    { name: "department", type: "text", description: "Department name" },
    { name: "tenure_years", type: "number", description: "Years at the company" },
    { name: "satisfaction_score", type: "number", description: "Score from 1 to 10" },
    { name: "feedback", type: "text", description: "Open-ended feedback about workplace culture" },
  ],
  "Support tickets": [
    { name: "ticket_id", type: "text", description: "Unique ticket identifier" },
    { name: "customer_name", type: "text", description: "Customer full name" },
    { name: "issue_category", type: "text", description: "Category of the issue" },
    { name: "priority", type: "text", description: "Low, Medium, High, or Critical" },
    { name: "issue_description", type: "text", description: "Description of the issue" },
    { name: "status", type: "text", description: "Current ticket status" },
  ],
  "Research interviews": [
    { name: "participant_id", type: "text", description: "Unique participant identifier" },
    { name: "age_group", type: "text", description: "Age group of the participant" },
    { name: "occupation", type: "text", description: "Participant occupation" },
    { name: "interview_question", type: "text", description: "The interview question asked" },
    { name: "participant_response", type: "text", description: "The participant response" },
  ],
  "Student feedback": [
    { name: "student_id", type: "text", description: "Unique student identifier" },
    { name: "course_name", type: "text", description: "Name of the course" },
    { name: "completion_status", type: "text", description: "Completed or In Progress" },
    { name: "rating", type: "number", description: "Rating from 1 to 5" },
    { name: "what_they_liked", type: "text", description: "What the student liked" },
    { name: "what_to_improve", type: "text", description: "What could be improved" },
  ],
};

const COLUMN_TYPES = ["text", "number"] as const;

function normalizeType(raw: string): SuggestedField["type"] | null {
  const s = raw.toLowerCase().trim();
  if (s === "text" || s === "string" || s === "str" || s === "txt") return "text";
  if (s === "number" || s === "num" || s === "int" || s === "integer" || s === "float" || s === "decimal") return "number";
  // fuzzy: check if close enough (e.g. "numbere", "textt", "nubmer")
  if (s.startsWith("num") || s.startsWith("nub") || s.startsWith("nmu")) return "number";
  if (s.startsWith("tex") || s.startsWith("txt") || s.startsWith("str")) return "text";
  return null;
}

type OutputFormat = "tabular" | "json" | "freetext" | "markdown" | "gift";
type Structure = "ai_decide" | "define_columns" | "use_template";
type RunMode = "preview" | "test" | "full";

// ─── Helpers ────────────────────────────────────────────────────────────────

function inferColumnType(values: string[]): SuggestedField["type"] {
  const nonEmpty = values.filter((v) => v.trim() !== "");
  if (nonEmpty.length === 0) return "text";
  if (nonEmpty.every((v) => !isNaN(Number(v)) && v.trim() !== "")) return "number";
  return "text";
}

function fieldsFromData(data: Record<string, unknown>[]): SuggestedField[] {
  if (data.length === 0) return [];
  const keys = Object.keys(data[0]);
  const sample = data.slice(0, 5);
  return keys.map((key) => {
    const values = sample.map((row) => String(row[key] ?? ""));
    return { name: key, type: inferColumnType(values), description: "" };
  });
}

function parseJsonResponse(text: string): Array<{ name: string; type: string; description: string }> {
  let cleaned = text.trim();
  // Strip markdown fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  // Try array
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch { /* fall through */ }
  }
  try { return JSON.parse(cleaned); } catch { return []; }
}

// ─── Module-level generation runner (survives navigation) ───────────────────

const TOOL_ID = "/generate";
const BATCH_SIZE = 25;

const activeGenerateJobs = new Map<string, Promise<void>>();

interface GenerateParams {
  mode: RunMode;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  description: string;
  outputFormat: string;
  isFreetext: boolean;
  isStructured: boolean;
  columns?: GenerateColumn[];
  rowCount: number;
  aiInstructions: string;
  resumeFrom?: number;
  existingData?: Record<string, unknown>[];
  existingRunId?: string | null;
}

async function executeGeneration(params: GenerateParams) {
  const store = useProcessingStore.getState();
  const totalCount = params.isFreetext ? 1 : (params.mode === "test" ? 10 : params.rowCount);
  const startFrom = params.resumeFrom ?? 0;
  const gen = store.startJob(TOOL_ID, params.mode, totalCount, startFrom);

  const localRunId = params.resumeFrom && params.existingRunId
    ? params.existingRunId
    : await dispatchCreateRun({
        runType: "generate",
        provider: params.provider,
        model: params.model,
        systemPrompt: params.aiInstructions,
        inputFile: "synthetic",
        inputRows: totalCount,
      });

  if (params.isFreetext) {
    const t0 = Date.now();
    try {
      const data = await dispatchGenerateRow({
        provider: params.provider,
        model: params.model,
        apiKey: params.apiKey,
        baseUrl: params.baseUrl,
        rowCount: 1,
        freeformPrompt: params.description || undefined,
        outputFormat: params.outputFormat === "markdown" ? "markdown" : params.outputFormat === "gift" ? "gift" : "freetext",
        systemPrompt: params.aiInstructions || undefined,
      });
      if (currentGeneration(TOOL_ID) !== gen) return;
      const latency = Date.now() - t0;
      const text = typeof data.raw === "string" ? data.raw : JSON.stringify(data.rows, null, 2);

      if (localRunId) {
        await dispatchSaveResults(localRunId, [{
          rowIndex: 0,
          input: { description: params.description || "synthetic", outputFormat: params.outputFormat },
          output: text,
          status: "success",
          latency,
        }]);
      }

      // Store raw text in a synthetic result row
      store.completeJob(TOOL_ID, [{ _raw: text, _format: params.outputFormat, status: "success" }], { success: 1, errors: 0, avgLatency: latency }, localRunId);
    } catch (err) {
      if (currentGeneration(TOOL_ID) !== gen) return;
      const latency = Date.now() - t0;
      store.completeJob(TOOL_ID, [{ status: "error", error_msg: String(err) }], { success: 0, errors: 1, avgLatency: latency }, localRunId);
    }
    return;
  }

  // Batched structured generation
  let accumulated: Record<string, unknown>[] = params.resumeFrom ? [...(params.existingData ?? [])] : [];
  let errors = 0;
  let generated = startFrom;
  const latencies: number[] = [];
  const effectiveStructure = params.isStructured && params.columns?.some((c) => c.name.trim()) ? "define_columns" : "ai_decide";

  while (generated < totalCount) {
    if (getAbortFlag(TOOL_ID) || currentGeneration(TOOL_ID) !== gen) break;

    const batchSize = Math.min(BATCH_SIZE, totalCount - generated);

    // Build context from already-generated rows so the LLM maintains consistency
    // across batches and resume. Show a sample of up to 5 recent rows.
    let contextPrompt = params.description || undefined;
    if (accumulated.length > 0) {
      const sample = accumulated.slice(-5);
      const sampleText = JSON.stringify(sample, null, 2);
      contextPrompt = `${params.description || "Generate realistic data."}\n\nHere are ${sample.length} rows already generated — continue producing new, unique rows that are consistent in style and content. Do NOT repeat these rows:\n${sampleText}`;
    }

    const t0 = Date.now();
    try {
      const data = await dispatchGenerateRow({
        provider: params.provider,
        model: params.model,
        apiKey: params.apiKey,
        baseUrl: params.baseUrl,
        rowCount: batchSize,
        columns: effectiveStructure === "define_columns" ? params.columns : undefined,
        freeformPrompt: contextPrompt,
        outputFormat: params.outputFormat,
        systemPrompt: params.aiInstructions || undefined,
      });

      latencies.push(Date.now() - t0);
      accumulated = [...accumulated, ...(data.rows as Row[])];
      generated += data.rows.length;
    } catch {
      latencies.push(Date.now() - t0);
      errors++;
      generated += batchSize;
    }

    if (currentGeneration(TOOL_ID) === gen) {
      // Update progress and intermediate results in store
      useProcessingStore.setState((state) => ({
        jobs: {
          ...state.jobs,
          [TOOL_ID]: {
            ...state.jobs[TOOL_ID],
            progress: { completed: generated, total: totalCount },
            results: accumulated.map((row) => ({ ...row, status: "success" as const })),
          },
        },
      }));
    }
  }

  if (currentGeneration(TOOL_ID) !== gen) return;

  // Compute average latency per row (spread batch latency across rows in that batch)
  const totalLatency = latencies.reduce((a, b) => a + b, 0);
  const avgLatency = accumulated.length > 0
    ? Math.round(totalLatency / accumulated.length)
    : 0;

  if (localRunId && accumulated.length > 0) {
    const resultRows = accumulated.map((row, i) => ({
      rowIndex: i,
      input: row as Record<string, unknown>,
      output: JSON.stringify(row),
      status: "success" as const,
      latency: avgLatency,
    }));
    await dispatchSaveResults(localRunId, resultRows);
  }
  const computedStats = { success: accumulated.length, errors, avgLatency };
  const finalResults = accumulated.map((row) => ({ ...row, _format: params.outputFormat, status: "success" as const }));
  store.completeJob(TOOL_ID, finalResults, computedStats, localRunId);
}

function launchGeneration(params: GenerateParams): Promise<void> {
  const promise = executeGeneration(params).catch((err) => {
    const job = useProcessingStore.getState().jobs[TOOL_ID];
    if (job?.isProcessing) {
      useProcessingStore.getState().completeJob(TOOL_ID, job.results ?? [], { success: 0, errors: 0, avgLatency: 0 }, job.runId ?? null);
    }
    console.error("Generate error:", err);
  }).finally(() => {
    activeGenerateJobs.delete(TOOL_ID);
  });
  activeGenerateJobs.set(TOOL_ID, promise);
  return promise;
}

// Stable default references (avoid new object per render → infinite loop)
const defaultProgress = { completed: 0, total: 0 };
const emptyResults: Record<string, unknown>[] = [];

// ─── Component ──────────────────────────────────────────────────────────────

export default function GeneratePage() {
  const activeModel = useActiveModel();
  // Processing flag is now handled by processing-store automatically

  const [description, setDescription] = useSessionState("generate_description", "");
  const [outputFormat, setOutputFormat] = useSessionState<OutputFormat>("generate_outputFormat", "tabular");
  const [, setStructure] = useSessionState<Structure>("generate_structure", "ai_decide");
  const [rowCount, setRowCount] = useSessionState("generate_rowCount", 100);
  const [columns, setColumns] = useSessionState<GenerateColumn[]>("generate_columns", [
    { name: "", type: "text" },
  ]);
  // Read processing state from the global store (survives navigation)
  const isGenerating = useProcessingStore((s) => s.jobs[TOOL_ID]?.isProcessing ?? false);
  const aborting = useProcessingStore((s) => s.jobs[TOOL_ID]?.aborting ?? false);
  const runMode = useProcessingStore((s) => s.jobs[TOOL_ID]?.runMode ?? "full") as RunMode;
  const progress = useProcessingStore((s) => s.jobs[TOOL_ID]?.progress ?? defaultProgress);
  const storeResults = useProcessingStore((s) => s.jobs[TOOL_ID]?.results ?? emptyResults);
  const runId = useProcessingStore((s) => s.jobs[TOOL_ID]?.runId ?? null);
  const requestAbort = useProcessingStore((s) => s.requestAbort);
  const clearJob = useProcessingStore((s) => s.clearJob);

  // Use the format that was active when results were generated, not the current radio
  const resultFormat = useMemo(() => {
    if (storeResults.length === 0) return null;
    return (storeResults[0]?._format as string) ?? null;
  }, [storeResults]);

  // Derive generated data from store results
  const generatedData = useMemo(() => {
    if (storeResults.length === 0) return [];
    // Freetext results have _raw field, structured results don't
    if (storeResults[0]?._raw) return [];
    return storeResults;
  }, [storeResults]);

  const generatedRaw = useMemo(() => {
    if (storeResults.length === 0) return "";
    if (storeResults[0]?._raw) return storeResults[0]._raw as string;
    if (resultFormat === "json" && storeResults.length > 0 && !storeResults[0]?._raw) {
      return JSON.stringify(storeResults, null, 2);
    }
    return "";
  }, [storeResults, resultFormat]);

  const failedCount = useMemo(() => storeResults.filter((r) => r.status === "error").length, [storeResults]);
  const skippedCount = useMemo(() => {
    if (!isGenerating && progress.total > 0 && progress.completed < progress.total) {
      return progress.total - progress.completed;
    }
    return 0;
  }, [isGenerating, progress]);

  // ── Suggested fields state ──
  const [suggestedFields, setSuggestedFields] = useSessionState<SuggestedField[]>("generate_suggestedFields", [
    { name: "", type: "text", description: "" },
    { name: "", type: "text", description: "" },
    { name: "", type: "text", description: "" },
  ]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [hasSuggestedOnce, setHasSuggestedOnce] = useSessionState("generate_hasSuggestedOnce", false);
  const [columnMode, setColumnMode] = useState<"suggest" | "file" | "paste">("suggest");
  const [fileExtracted, setFileExtracted] = useState(false);
  const [pasteExtracted, setPasteExtracted] = useState(false);
  const [csvPasteText, setCsvPasteText] = useState("");

  const isStructured = outputFormat === "tabular" || outputFormat === "json";
  const isFreetext = outputFormat === "freetext" || outputFormat === "markdown" || outputFormat === "gift";

  // ── Auto-generate AI Instructions ──
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a synthetic data generator. Produce realistic, diverse, high-quality data.");
    lines.push("");

    if (description.trim()) {
      lines.push("DATA DESCRIPTION:");
      lines.push(description.trim());
      lines.push("");
    }

    const namedCols = columns.filter((c) => c.name.trim());
    if (namedCols.length > 0) {
      lines.push("SCHEMA:");
      namedCols.forEach((c) => {
        lines.push(`- ${c.name} (${c.type})${c.description ? `: ${c.description}` : ""}`);
      });
      lines.push("");
    }

    lines.push("OUTPUT RULES:");
    if (outputFormat === "gift") {
      lines.push("- Format: Moodle GIFT (General Import Format Technology)");
      lines.push("- Each question separated by a blank line");
      lines.push("- Use GIFT syntax: = for correct answers, ~ for wrong answers");
      lines.push("- Support all question types: multiple choice, true/false, short answer, matching, numerical, essay");
      lines.push("");
      lines.push("STRICTLY FORBIDDEN: JSON, code fences, HTML, markdown formatting.");
    } else if (outputFormat === "markdown") {
      lines.push("- Format: Markdown with headings, lists, bold, tables where appropriate");
      lines.push("- Write well-structured, human-readable Markdown content");
      lines.push("");
      lines.push("STRICTLY FORBIDDEN: JSON, code fences, arrays, objects, structured data formats.");
    } else if (isFreetext) {
      lines.push("- Format: plain readable text (NOT JSON, NOT structured data)");
      lines.push("- Write naturally formatted, human-readable content");
      lines.push("");
      lines.push("STRICTLY FORBIDDEN: JSON, code fences, arrays, objects, structured data formats.");
    } else {
      lines.push(`- Format: ${outputFormat}`);
      lines.push(`- Rows: ${rowCount}`);
      lines.push("");
      lines.push("STRICTLY FORBIDDEN: markdown, code fences, placeholders, duplicate rows.");
    }
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [description, columns, outputFormat, rowCount, isStructured]);

  // ── AI Instructions state ──
  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);


  const canGenerate = description.trim().length > 0 && (isFreetext || columns.some((c) => c.name.trim()));

  // ── Suggested fields helpers ──

  const updateSuggestion = useCallback((idx: number, updates: Partial<SuggestedField>) => {
    setSuggestedFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  }, []);

  const removeSuggestion = useCallback((idx: number) => {
    setSuggestedFields((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const addSuggestion = useCallback(() => {
    setSuggestedFields((prev) => [...prev, { name: "", type: "text", description: "" }]);
  }, []);

  const moveSuggestion = useCallback((idx: number, dir: -1 | 1) => {
    setSuggestedFields((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  // ── Sync suggested fields → columns ──
  useEffect(() => {
    const checked = suggestedFields.filter((f) => f.name.trim());
    if (checked.length > 0) {
      setColumns(checked.map((f) => ({ name: f.name, type: f.type, description: f.description })));
      setStructure("define_columns");
    }
  }, [suggestedFields]);

  // ── Session restore from history ──
  const restored = useRestoreSession("generate");
  useEffect(() => {
    if (!restored) return;
    queueMicrotask(() => {
      const fullPrompt = restored.systemPrompt ?? "";

      // Restore description
      const descMatch = fullPrompt.match(/DATA DESCRIPTION:\n([\s\S]*?)(?:\n\n|$)/);
      if (descMatch) setDescription(descMatch[1].trim());

      // Restore output format
      if (fullPrompt.includes("Format: Moodle GIFT")) setOutputFormat("gift");
      else if (fullPrompt.includes("Format: Markdown")) setOutputFormat("markdown");
      else if (fullPrompt.includes("Format: plain readable text")) setOutputFormat("freetext");
      else if (fullPrompt.includes("Format: json")) setOutputFormat("json");
      else if (fullPrompt.includes("Format: tabular")) setOutputFormat("tabular");

      // Restore row count
      const rowsMatch = fullPrompt.match(/Rows: (\d+)/);
      if (rowsMatch) setRowCount(parseInt(rowsMatch[1], 10));

      // Restore schema/columns
      const schemaMatch = fullPrompt.match(/SCHEMA:\n([\s\S]*?)(?:\n\n|$)/);
      if (schemaMatch) {
        const fields: SuggestedField[] = schemaMatch[1].split("\n").map((line) => {
          const m = line.match(/^- (.+?) \((\w+)\)(?:: (.+))?$/);
          if (!m) return null;
          return { name: m[1], type: (m[2] as SuggestedField["type"]) || "text", description: m[3] || "" };
        }).filter((f): f is SuggestedField => f !== null);
        if (fields.length > 0) {
          setSuggestedFields(fields);
          setColumnMode("suggest");
          setHasSuggestedOnce(true);
        }
      }

      // Restore results into processing-store
      if (restored.results.length > 0) {
        const firstResult = restored.results[0];
        const output = firstResult.ai_output as string | undefined;
        const isFreetextRestore = fullPrompt.includes("Format: plain readable text") ||
          fullPrompt.includes("Format: Markdown") ||
          fullPrompt.includes("Format: Moodle GIFT");
        const isJsonRestore = fullPrompt.includes("Format: json");
        const restoredFormat: string = isFreetextRestore ? "freetext"
          : fullPrompt.includes("Format: Markdown") ? "markdown"
          : fullPrompt.includes("Format: Moodle GIFT") ? "gift"
          : isJsonRestore ? "json" : "tabular";

        if ((isFreetextRestore || isJsonRestore) && output) {
          useProcessingStore.getState().completeJob(
            TOOL_ID,
            [{ _raw: output, _format: restoredFormat, status: "success" }],
            { success: 1, errors: 0, avgLatency: 0 },
            restored.runId,
          );
        } else {
          const cleanResults = restored.results.map((row) => {
            const clean: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(row)) {
              if (k !== "status" && k !== "latency_ms" && k !== "error_msg" && k !== "ai_output") clean[k] = v;
            }
            return { ...clean, _format: restoredFormat, status: "success" };
          });
          useProcessingStore.getState().completeJob(
            TOOL_ID,
            cleanResults,
            { success: cleanResults.length, errors: 0, avgLatency: 0 },
            restored.runId,
          );
        }
      }

      toast.success(`Restored generate session (${restored.results.length} results)`);
    });
  }, [restored]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── AI suggest fields ──
  const suggestFields = async () => {
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");
    if (!description.trim()) return toast.error("Enter a description first.");

    setIsSuggesting(true);
    try {
      const systemPrompt = getPrompt("generate.column_suggestions");
      const { output } = await dispatchProcessRow({
        provider: activeModel.providerId,
        model: activeModel.defaultModel,
        apiKey: activeModel.apiKey || "",
        baseUrl: activeModel.baseUrl,
        systemPrompt,
        userContent: description,
      });
      const parsed = parseJsonResponse(output);
      if (parsed.length === 0) {
        toast.error("Could not parse AI suggestions. Try again.");
        return;
      }
      const validTypes = new Set(COLUMN_TYPES);
      const fields: SuggestedField[] = parsed.map((f) => ({
        name: f.name || "",
        type: validTypes.has(f.type as SuggestedField["type"]) ? (f.type as SuggestedField["type"]) : "text",
        description: f.description || "",
      }));
      setSuggestedFields(fields);
      setHasSuggestedOnce(true);
      toast.success(`${fields.length} fields suggested`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Suggestion failed", { description: msg });
    } finally {
      setIsSuggesting(false);
    }
  };

  // ── From imported file ──
  const handleTemplateFile = useCallback((data: Record<string, unknown>[], _fileName: string) => {
    if (data.length === 0) {
      toast.error("No rows found in file.");
      return;
    }
    const fields: SuggestedField[] = [];
    const warnings: string[] = [];
    for (const row of data) {
      const values = Object.values(row).map((v) => String(v ?? "").trim());
      if (values.length === 0 || !values[0]) continue;
      const name = values[0];
      const rawType = values[1] || "";
      const resolved = normalizeType(rawType);
      if (rawType && !resolved) warnings.push(`"${name}": unknown type "${rawType}" → defaulted to text`);
      const type = resolved ?? "text";
      const description = values.slice(2).join(", ");
      fields.push({ name, type, description });
    }
    if (fields.length === 0) {
      toast.error("No columns found. File should have rows: column_name, type, description");
      return;
    }
    setSuggestedFields(fields);
    setFileExtracted(true);
    if (warnings.length > 0) toast.warning(warnings.join("\n"));
    toast.success(`${fields.length} columns imported`);
  }, []);

  // ── From pasted CSV text ──
  const extractFromPastedCsv = useCallback(() => {
    if (!csvPasteText.trim()) {
      setSuggestedFields([{ name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }]);
      setCsvPasteText("");
      setPasteExtracted(true);
      return;
    }
    const lines = csvPasteText.trim().split("\n").filter((l) => l.trim());
    const fields: SuggestedField[] = [];
    const warnings: string[] = [];
    for (const line of lines) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length === 0 || !parts[0]) continue;
      const name = parts[0];
      const rawType = parts[1] || "";
      const resolved = normalizeType(rawType);
      if (rawType && !resolved) warnings.push(`"${name}": unknown type "${rawType}" → defaulted to text`);
      const type = resolved ?? "text";
      const description = parts.slice(2).join(", ");
      fields.push({ name, type, description });
    }
    if (fields.length === 0) {
      setSuggestedFields([{ name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }]);
      setCsvPasteText("");
      setPasteExtracted(true);
      return;
    }
    if (warnings.length > 0) toast.warning(warnings.join("\n"));
    setSuggestedFields(fields);
    setCsvPasteText("");
    setPasteExtracted(true);
    toast.success(`${fields.length} columns extracted`);
  }, [csvPasteText]);

  // ── Generate (delegates to module-level runner) ──
  const generate = useCallback(async (mode: RunMode, resumeFrom?: number) => {
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");
    if (!description.trim()) return toast.error("Enter a description first.");
    if (isStructured && !columns.some((c) => c.name.trim())) return toast.error("Define at least one column.");
    if (isStructured && columns.some((c) => c.name.trim()) && columns.some((c) => !c.name.trim())) return toast.error("All column names must be filled in.");

    await launchGeneration({
      mode,
      provider: activeModel.providerId,
      model: activeModel.defaultModel,
      apiKey: activeModel.apiKey || "",
      baseUrl: activeModel.baseUrl,
      description,
      outputFormat,
      isFreetext,
      isStructured,
      columns: columns.filter((c) => c.name.trim()),
      rowCount,
      aiInstructions,
      resumeFrom,
      existingData: resumeFrom ? generatedData : undefined,
      existingRunId: resumeFrom ? runId : undefined,
    });

    // Toast on completion (only if we're still on this page)
    const job = useProcessingStore.getState().jobs[TOOL_ID];
    if (job && !job.isProcessing) {
      if (job.stats?.errors === 0 && job.results.length > 0) {
        toast.success(isFreetext ? "Generated successfully" : `Generated ${job.results.length} rows`);
      } else if (job.stats?.errors) {
        toast.warning(`Done — ${job.stats.errors} batch(es) had errors`);
      }
    }
  }, [activeModel, description, outputFormat, isFreetext, isStructured, columns, rowCount, aiInstructions, generatedData, runId]);

  const handleAbort = useCallback(() => {
    requestAbort(TOOL_ID);
  }, [requestAbort]);

  const handleResume = useCallback(() => {
    // Preserve original run mode (e.g. "test" = 10 rows) instead of hardcoding "full"
    const originalMode = useProcessingStore.getState().jobs[TOOL_ID]?.runMode ?? "full";
    generate(originalMode, progress.completed);
  }, [generate, progress.completed]);

  const handleCancel = useCallback(() => {
    clearJob(TOOL_ID);
  }, [clearJob]);


  return (
    <div className="space-y-0 pb-16">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">Generate Data</h1>
          <p className="text-muted-foreground text-sm">
            Create synthetic datasets with AI-powered generation. Describe what you need and let AI build it for you.
          </p>
        </div>
        <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("generate_"); clearJob(TOOL_ID); setDescription(""); setColumns([{ name: "", type: "text" }]); setOutputFormat("tabular"); setStructure("ai_decide"); setRowCount(100); setSuggestedFields([{ name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }]); setHasSuggestedOnce(false); setAiInstructions(""); setColumnMode("suggest"); setFileExtracted(false); setPasteExtracted(false); }}>
            <RotateCcw className="h-3.5 w-3.5" /> Start Over
          </Button>
      </div>

      <div className={isGenerating ? "pointer-events-none opacity-60" : ""}>
      {/* ── 1. Describe Your Data ───────────────────────────────────────── */}
      <div className="space-y-3 pb-8">
        <h2 className="text-2xl font-bold">1. Describe Data</h2>
        <PromptEditor
          value={description}
          onChange={(val) => {
            setDescription(val);
            const match = Object.entries(SAMPLE_PROMPTS).find(([, v]) => v === val);
            if (match && SAMPLE_COLUMNS[match[0]]) {
              setSuggestedFields(SAMPLE_COLUMNS[match[0]]);
              setHasSuggestedOnce(false);
              setColumnMode("suggest");
            }
          }}
          placeholder="Example: Generate realistic customer profiles including full names, email addresses, and purchase history..."
          examplePrompts={SAMPLE_PROMPTS}
          label="Instructions"
        />
      </div>

      <div className="border-t" />

      {/* ── 2. Output Format ──────────────────────────────────────────────── */}
      <div className="space-y-3 py-8">
        <h2 className="text-2xl font-bold">2. Output Format</h2>
        <div className="grid grid-cols-2 gap-6">
          {/* Structured Data */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Structured Data</p>
            {([
              { value: "tabular", label: "CSV/Excel", desc: "Structured rows and columns - best for spreadsheets and data analysis" },
              { value: "json", label: "JSON", desc: "Nested structured data - best for APIs and complex relationships" },
            ] as const).map(({ value, label, desc }) => (
              <label key={value} className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="radio"
                  name="outputFormat"
                  value={value}
                  checked={outputFormat === value}
                  onChange={() => setOutputFormat(value)}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <div className="text-sm font-medium leading-snug">{label}</div>
                  {outputFormat === value && (
                    <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
          {/* Unstructured Data */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unstructured Data</p>
            {([
              { value: "freetext", label: "Free Text", desc: "Unstructured text output - best for qualitative data" },
              { value: "markdown", label: "Markdown", desc: "Formatted text with headings, lists, and emphasis - best for documents and reports" },
              { value: "gift", label: "GIFT (Moodle)", desc: "Moodle quiz format - generates questions importable into Moodle LMS" },
            ] as const).map(({ value, label, desc }) => (
              <label key={value} className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="radio"
                  name="outputFormat"
                  value={value}
                  checked={outputFormat === value}
                  onChange={() => setOutputFormat(value)}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <div className="text-sm font-medium leading-snug">{label}</div>
                  {outputFormat === value && (
                    <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ── 3. Define Columns (structured only) ──────────────────────────── */}
      {isStructured && (<>
        <div className="border-t" />
        <div className="space-y-4 py-8">
          <h2 className="text-2xl font-bold">3. Define Columns</h2>
          <p className="text-sm text-muted-foreground -mt-2">
            Define your output columns. Use AI to suggest columns from your description, or add them manually.
          </p>

          <div className="flex gap-2 flex-wrap">
            <Button
              variant={columnMode === "suggest" ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => setColumnMode("suggest")}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Suggest with AI
            </Button>
            <Button
              variant={columnMode === "paste" ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => setColumnMode("paste")}
            >
              <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
              Type CSV
            </Button>
            <Button
              variant={columnMode === "file" ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => setColumnMode("file")}
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Import CSV/Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                const named = suggestedFields.filter((f) => f.name.trim());
                const rows = named.length > 0
                  ? named.map((f) => ({ column_name: f.name, type: f.type, description: f.description }))
                  : [{ column_name: "", type: "", description: "" }];
                const ws = XLSX.utils.json_to_sheet(rows, { header: ["column_name", "type", "description"] });
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Schema");
                XLSX.writeFile(wb, "column_schema.xlsx");
              }}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export Excel
            </Button>
          </div>

          {/* ── Suggest with AI mode ── */}
          {columnMode === "suggest" && (
            <>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={suggestFields} disabled={isSuggesting}>
                  {isSuggesting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                  {hasSuggestedOnce ? "Retry AI" : "Ask AI"}
                </Button>
                {isSuggesting && <span className="text-xs text-muted-foreground">Suggesting columns...</span>}
              </div>
              <div className="border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">
                  Column Schema
                </div>
                <div className="px-3 pt-2 flex gap-2 items-center text-xs font-medium text-muted-foreground">
                  <div className="shrink-0 w-6" />
                  <div className="flex-1">column_name</div>
                  <div className="w-28">type</div>
                  <div className="flex-1">description</div>
                  <div className="w-8 shrink-0" />
                </div>
                <div className="p-3 space-y-2">
                  {suggestedFields.map((field, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <div className="flex flex-col shrink-0">
                        <Button variant="ghost" size="icon" className="h-4 w-6 text-muted-foreground hover:text-foreground" onClick={() => moveSuggestion(idx, -1)} disabled={idx === 0}>
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-4 w-6 text-muted-foreground hover:text-foreground" onClick={() => moveSuggestion(idx, 1)} disabled={idx === suggestedFields.length - 1}>
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                      <Input placeholder="column_name" value={field.name} onChange={(e) => updateSuggestion(idx, { name: e.target.value })} className="flex-1 h-8 text-xs" />
                      <Select value={field.type} onValueChange={(v) => updateSuggestion(idx, { type: v as SuggestedField["type"] })}>
                        <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COLUMN_TYPES.map((t) => (<SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>))}
                        </SelectContent>
                      </Select>
                      <Input placeholder="Description (optional)" value={field.description} onChange={(e) => updateSuggestion(idx, { description: e.target.value })} className="flex-1 h-8 text-xs" />
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeSuggestion(idx)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="px-3 pb-3 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={addSuggestion}>
                    <Plus className="h-3 w-3 mr-2" /> Add Column
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs text-destructive hover:bg-destructive/10" onClick={() => setSuggestedFields([{ name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }])}>
                    <Trash2 className="h-3 w-3 mr-2" /> Clear All
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ── Import mode ── */}
          {columnMode === "file" && !fileExtracted && !suggestedFields.some((f) => f.name.trim()) && (
            <div className="max-w-md">
              <FileUploader
                onDataLoaded={handleTemplateFile}
                accept={{
                  "text/csv": [".csv"],
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
                  "application/vnd.ms-excel": [".xls"],
                }}
              />
            </div>
          )}
          {columnMode === "file" && (fileExtracted || suggestedFields.some((f) => f.name.trim())) && (
            <>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => {
              setFileExtracted(false);
              setSuggestedFields([{ name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }]);
            }}>
              <Upload className="h-3.5 w-3.5 mr-1.5" /> {fileExtracted ? "Re-import" : "Import"}
            </Button>
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">Column Schema</div>
              <div className="px-3 pt-2 flex gap-2 items-center text-xs font-medium text-muted-foreground">
                <div className="shrink-0 w-6" />
                <div className="flex-1">column_name</div>
                <div className="w-28">type</div>
                <div className="flex-1">description</div>
                <div className="w-8 shrink-0" />
              </div>
              <div className="p-3 space-y-2">
                {suggestedFields.map((field, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <div className="flex flex-col shrink-0">
                      <Button variant="ghost" size="icon" className="h-4 w-6 text-muted-foreground hover:text-foreground" onClick={() => moveSuggestion(idx, -1)} disabled={idx === 0}>
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-4 w-6 text-muted-foreground hover:text-foreground" onClick={() => moveSuggestion(idx, 1)} disabled={idx === suggestedFields.length - 1}>
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                    <Input placeholder="column_name" value={field.name} onChange={(e) => updateSuggestion(idx, { name: e.target.value })} className="flex-1 h-8 text-xs" />
                    <Select value={field.type} onValueChange={(v) => updateSuggestion(idx, { type: v as SuggestedField["type"] })}>
                      <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COLUMN_TYPES.map((t) => (<SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <Input placeholder="Description (optional)" value={field.description} onChange={(e) => updateSuggestion(idx, { description: e.target.value })} className="flex-1 h-8 text-xs" />
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeSuggestion(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="px-3 pb-3 flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={addSuggestion}>
                  <Plus className="h-3 w-3 mr-2" /> Add Column
                </Button>
                <Button variant="outline" size="sm" className="text-xs text-destructive hover:bg-destructive/10" onClick={() => setSuggestedFields([{ name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }])}>
                  <Trash2 className="h-3 w-3 mr-2" /> Clear All
                </Button>
              </div>
            </div>
            </>
          )}

          {/* ── Paste CSV mode ── */}
          {columnMode === "paste" && !pasteExtracted && !suggestedFields.some((f) => f.name.trim()) && (
            <div className="space-y-2">
              <Textarea
                placeholder={"One column per line: column_name, type, description\n\nname, text, the name of the player\nage, number, age of the player\ncity, text, hometown"}
                className="min-h-[100px] text-xs font-mono resize-y"
                value={csvPasteText}
                onChange={(e) => setCsvPasteText(e.target.value)}
              />
              <Button variant="outline" size="sm" className="text-xs" onClick={extractFromPastedCsv}>
                Extract Columns
              </Button>
            </div>
          )}
          {columnMode === "paste" && (pasteExtracted || suggestedFields.some((f) => f.name.trim())) && (
            <>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => {
              const text = suggestedFields.filter((f) => f.name.trim()).map((f) => `${f.name}, ${f.type}, ${f.description}`).join("\n");
              setCsvPasteText(text);
              setPasteExtracted(false);
              setSuggestedFields([{ name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }]);
            }}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">Column Schema</div>
              <div className="px-3 pt-2 flex gap-2 items-center text-xs font-medium text-muted-foreground">
                <div className="shrink-0 w-6" />
                <div className="flex-1">column_name</div>
                <div className="w-28">type</div>
                <div className="flex-1">description</div>
                <div className="w-8 shrink-0" />
              </div>
              <div className="p-3 space-y-2">
                {suggestedFields.map((field, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <div className="flex flex-col shrink-0">
                      <Button variant="ghost" size="icon" className="h-4 w-6 text-muted-foreground hover:text-foreground" onClick={() => moveSuggestion(idx, -1)} disabled={idx === 0}>
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-4 w-6 text-muted-foreground hover:text-foreground" onClick={() => moveSuggestion(idx, 1)} disabled={idx === suggestedFields.length - 1}>
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                    <Input placeholder="column_name" value={field.name} onChange={(e) => updateSuggestion(idx, { name: e.target.value })} className="flex-1 h-8 text-xs" />
                    <Select value={field.type} onValueChange={(v) => updateSuggestion(idx, { type: v as SuggestedField["type"] })}>
                      <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COLUMN_TYPES.map((t) => (<SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <Input placeholder="Description (optional)" value={field.description} onChange={(e) => updateSuggestion(idx, { description: e.target.value })} className="flex-1 h-8 text-xs" />
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeSuggestion(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="px-3 pb-3 flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={addSuggestion}>
                  <Plus className="h-3 w-3 mr-2" /> Add Column
                </Button>
                <Button variant="outline" size="sm" className="text-xs text-destructive hover:bg-destructive/10" onClick={() => setSuggestedFields([{ name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }])}>
                  <Trash2 className="h-3 w-3 mr-2" /> Clear All
                </Button>
              </div>
            </div>
            </>
          )}
        </div>
      </>)}

      <div className="border-t" />

      {/* ── AI Instructions ────────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={isStructured ? 4 : 3}
        value={aiInstructions}
        onChange={setAiInstructions}
      />

      {/* No model warning */}
      {canGenerate && !activeModel && (
        <div className="pt-4">
          <NoModelWarning activeModel={activeModel} />
        </div>
      )}
      </div>

      <div className="border-t" />

      {/* ── Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">{isStructured ? "5" : "4"}. Execute</h2>
        {/* ── Progress bar + stop/resume/cancel ── */}
        {isStructured && (isGenerating || (!isGenerating && (failedCount + skippedCount) > 0)) && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground flex-wrap gap-1">
              <span className="flex items-center gap-1.5">
                {isGenerating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {aborting ? "Stopping — waiting for in-flight rows..." : `Generating ${progress.total} rows...`}
                  </>
                ) : (
                  <>
                    Stopped — {progress.completed - failedCount} of {progress.total} completed
                    {failedCount > 0 && <span className="text-red-500 ml-1">({failedCount} errors)</span>}
                  </>
                )}
              </span>
              <div className="flex items-center gap-2">
                {isGenerating && <span>{progress.completed} / {progress.total}</span>}
                {isGenerating && !aborting && (
                  <Button variant="outline" size="sm" onClick={handleAbort} className="h-6 px-2 text-[11px] border-red-300 text-red-600 hover:bg-red-50">
                    Stop
                  </Button>
                )}
                {!isGenerating && (failedCount + skippedCount) > 0 && (
                  <>
                    <Button variant="outline" size="sm" disabled={!canGenerate || !activeModel} onClick={handleResume} className="h-6 px-2 text-[11px] border-green-300 text-green-700 hover:bg-green-50">
                      <Play className="h-3 w-3 mr-1" /> Resume ({failedCount + skippedCount} rows)
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleCancel} className="h-6 px-2 text-[11px] border-muted-foreground/30 text-muted-foreground hover:bg-muted">
                      <X className="h-3 w-3 mr-1" /> Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div
                className={`${aborting || (!isGenerating && (failedCount + skippedCount) > 0) ? "bg-amber-400" : "bg-black dark:bg-white"} h-full transition-all duration-300`}
                style={{ width: `${progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Freetext/Markdown progress ── */}
        {isFreetext && isGenerating && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {aborting ? "Stopping\u2026" : "Generating content\u2026"}
              </span>
              {!aborting && (
                <Button variant="outline" size="sm" onClick={handleAbort} className="h-6 px-2 text-[11px] border-red-300 text-red-600 hover:bg-red-50">
                  Stop
                </Button>
              )}
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div className={`${aborting ? "bg-amber-400" : "bg-black dark:bg-white"} h-full animate-pulse`} style={{ width: "60%" }} />
            </div>
          </div>
        )}

        {/* ── Buttons ── */}
        {isStructured ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              variant="outline"
              size="lg"
              className="h-12 text-base"
              disabled={!canGenerate || isGenerating || !activeModel}
              onClick={() => generate("test")}
            >
              {isGenerating && runMode === "test" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Test (10 rows)
            </Button>
            <div className="flex items-center h-12 rounded-lg overflow-hidden border border-red-500">
              <button
                className="h-full px-5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white border-r border-red-400/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => setRowCount((n) => Math.max(10, n - 10))}
                disabled={isGenerating || rowCount <= 10 || !canGenerate || !activeModel}
              >
                <Minus className="h-5 w-5 stroke-[2.5]" />
              </button>
              <Button
                size="lg"
                className="h-full flex-1 rounded-none text-base bg-red-500 hover:bg-red-600 text-white"
                disabled={!canGenerate || isGenerating || !activeModel}
                onClick={() => generate("full")}
              >
                {isGenerating && runMode === "full" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                {isGenerating && runMode === "full" ? "Generating…" : `Generate All (${rowCount} rows)`}
              </Button>
              <button
                className="h-full px-5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white border-l border-red-400/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => setRowCount((n) => n + 10)}
                disabled={isGenerating || !canGenerate || !activeModel}
              >
                <Plus className="h-5 w-5 stroke-[2.5]" />
              </button>
            </div>
          </div>
        ) : (
          <SingleRunButton
            label="Generate"
            runningLabel="Generating…"
            isProcessing={isGenerating}
            disabled={!canGenerate || !activeModel}
            onRun={() => generate("full")}
          />
        )}
      </div>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {(generatedData.length > 0 || generatedRaw) && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Generated Data</h2>
              {generatedData.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {generatedData.length} rows × {Object.keys(generatedData[0]).length} columns
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {runId && (
                <Link href={`/history/${runId}`} className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  View in History
                </Link>
              )}
              {generatedRaw && resultFormat && resultFormat !== "tabular" && (
                <Button variant="outline" className="gap-2 px-5" onClick={() => {
                  const ext = resultFormat === "json" ? "json" : resultFormat === "markdown" ? "md" : resultFormat === "gift" ? "gift" : "txt";
                  const blob = new Blob([generatedRaw], { type: "text/plain;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `generated_${Date.now()}.${ext}`; a.click();
                  URL.revokeObjectURL(url);
                }}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                </Button>
              )}
            </div>
          </div>

          {generatedData.length > 0 && resultFormat !== "json" ? (
            <div>
              <div className="px-4 py-2.5 border border-b-0 rounded-t-lg bg-muted/20 text-sm font-medium flex items-center justify-between">
                <span>Generated Data — {generatedData.length} rows</span>
                <ExportDropdown data={generatedData} filename="generated_data" />
              </div>
              <div className="border rounded-b-lg overflow-hidden">
                <DataTable data={generatedData} />
              </div>
            </div>
          ) : generatedRaw ? (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/20 text-xs font-medium text-muted-foreground">Raw output</div>
              <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{generatedRaw}</pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
