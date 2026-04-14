"use client";

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useFilesRef, useFileStatuses, fileKey } from "@/hooks/useFilesRef";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ResultsPanel } from "@/components/tools/ResultsPanel";
import { PromptEditor } from "@/components/tools/PromptEditor";
import { FileUploader } from "@/components/tools/FileUploader";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useRestoreSession } from "@/hooks/useRestoreSession";
import { useProcessingStore } from "@/lib/processing-store";
import { ExecutionPanel } from "@/components/tools/ExecutionPanel";
import { dispatchDocumentProcess, dispatchDocumentAnalyze } from "@/lib/llm-dispatch";
import pLimit from "p-limit";
import { downloadText, downloadMarkdown } from "@/lib/export";
import Link from "next/link";
import {
  FileText,
  Upload,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Trash2,
  RotateCcw,
  Copy,
  Check,
  Sparkles,
  Plus,
  ArrowUp,
  ArrowDown,
  ClipboardPaste,
  Pencil,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import type { FileState } from "@/types";
import * as XLSX from "xlsx";
import { isLikelyChunked } from "@/lib/chunk-text";

// ─── Constants ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

type OutputFormat = "csv" | "json" | "txt" | "md" | "gift";

interface SuggestedField {
  name: string;
  type: "text" | "number";
  description: string;
}

const COLUMN_TYPES = ["text", "number"] as const;

const SAMPLE_PROMPTS: Record<string, string> = {
  "Summarize in 3 bullet points": "Summarize this document in 3 bullet points",
  "Translate to French": "Translate this document to French",
  "Extract key findings": "Extract the key findings and recommendations",
  "List entities": "List all people, organizations, and dates mentioned",
  "Main argument": "Answer: What is the main argument of this paper?",
  "Create outline": "Create a structured outline of this document",
};

function getFileTypeKey(file: File): string | null {
  const name = file.name.toLowerCase();
  const exts: Record<string, string[]> = {
    txt_md: [".txt", ".md"], pdf: [".pdf"], docx: [".docx"],
    excel: [".xlsx", ".xls"], json_csv: [".json", ".csv"], html: [".html", ".htm"],
  };
  for (const [, extList] of Object.entries(exts)) {
    if (extList.some((ext) => name.endsWith(ext))) return "supported";
  }
  return null;
}

function normalizeType(raw: string): SuggestedField["type"] | null {
  const s = raw.toLowerCase().trim();
  if (s === "text" || s === "string" || s === "str" || s === "txt") return "text";
  if (s === "number" || s === "num" || s === "int" || s === "integer" || s === "float" || s === "decimal") return "number";
  if (s.startsWith("num") || s.startsWith("nub") || s.startsWith("nmu")) return "number";
  if (s.startsWith("tex") || s.startsWith("txt") || s.startsWith("str")) return "text";
  return null;
}

interface DocResult {
  document_name: string;
  output: string;
}

const EMPTY_SUGGESTED: SuggestedField[] = [
  { name: "", type: "text", description: "" },
  { name: "", type: "text", description: "" },
  { name: "", type: "text", description: "" },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProcessDocumentsPage() {
  const activeModel = useActiveModel();
  const systemSettings = useSystemSettings();

  // ── Section 1: Documents
  const [fileStates, setFileStates] = useSessionState<FileState[]>("procdocs2_fileStates", []);
  const filesRef = useFilesRef();

  // ── Section 2: Instructions
  const [customPrompt, setCustomPrompt] = useSessionState("procdocs2_customPrompt", "");

  // ── Section 3: Output Format
  const [outputFormat, setOutputFormat] = useSessionState<OutputFormat>("procdocs2_outputFormat", "txt");

  // ── Section 4 (structured only): Define Columns
  const [suggestedFields, setSuggestedFields] = useSessionState<SuggestedField[]>(
    "procdocs2_suggestedFields",
    EMPTY_SUGGESTED,
  );
  const [hasSuggestedOnce, setHasSuggestedOnce] = useSessionState("procdocs2_hasSuggestedOnce", false);
  const [columnMode, setColumnMode] = useState<"suggest" | "file" | "paste">("suggest");
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [fileExtracted, setFileExtracted] = useState(false);
  const [pasteExtracted, setPasteExtracted] = useState(false);
  const [csvPasteText, setCsvPasteText] = useState("");

  const isStructured = outputFormat === "csv" || outputFormat === "json";

  // ── Auto-generate AI Instructions
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a document processing assistant. Process the document according to the user's instructions.");
    lines.push("");

    if (customPrompt.trim()) {
      lines.push("USER INSTRUCTIONS:");
      lines.push(customPrompt.trim());
      lines.push("");
    }

    const namedCols = suggestedFields.filter((c) => c.name.trim());
    if (isStructured && namedCols.length > 0) {
      lines.push("SCHEMA:");
      namedCols.forEach((c) => {
        lines.push(`- ${c.name} (${c.type})${c.description ? `: ${c.description}` : ""}`);
      });
      lines.push("");
    }

    lines.push("OUTPUT FORMAT:");
    if (outputFormat === "csv") {
      lines.push("- Return ONLY raw CSV. Row 1: header. Rows 2+: one record per row.");
      if (namedCols.length > 0) {
        lines.push(`- Header MUST be exactly: ${namedCols.map((c) => c.name).join(", ")}`);
      }
      lines.push("- Wrap fields containing commas or line breaks in double quotes.");
      lines.push("- STRICTLY FORBIDDEN: markdown, code blocks, JSON, explanations, or prose.");
    } else if (outputFormat === "json") {
      lines.push("- Return ONLY a JSON array of objects. Nothing else.");
      if (namedCols.length > 0) {
        lines.push(`- Each object MUST have exactly these keys: ${namedCols.map((c) => c.name).join(", ")}`);
      }
      lines.push("- STRICTLY FORBIDDEN: markdown, code fences, CSV, prose, or any text outside the JSON array.");
    } else if (outputFormat === "md") {
      lines.push("- Return Markdown with headings, lists, bold, tables where appropriate.");
    } else if (outputFormat === "gift") {
      lines.push("- Return Moodle GIFT format (General Import Format Technology).");
      lines.push("- Each question on its own line using GIFT syntax.");
    } else {
      lines.push("- Return plain readable text.");
    }
    lines.push("");

    lines.push("RULES:");
    lines.push("- Follow the instructions precisely");
    lines.push("- Base your response only on the document content provided");
    lines.push("- Return only the requested output — no preamble or commentary");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [customPrompt, outputFormat, suggestedFields, isStructured]);

  // ── Section 5: AI Instructions
  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // ── System prompt ──────────────────────────────────────────────────────────
  const buildSystemPrompt = (): string => {
    if (aiInstructions.trim()) return aiInstructions;
    if (customPrompt.trim()) return `You are a document processing assistant.\n\nINSTRUCTIONS:\n${customPrompt.trim()}\n\nReturn only the requested output. No preamble or commentary.`;
    return "You are a document processing assistant. Process the document according to the user's instructions. Return your response as plain text.";
  };

  // ── Column helpers ─────────────────────────────────────────────────────────
  const updateSuggestion = useCallback((idx: number, updates: Partial<SuggestedField>) => {
    setSuggestedFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  }, [setSuggestedFields]);

  const removeSuggestion = useCallback((idx: number) => {
    setSuggestedFields((prev) => prev.filter((_, i) => i !== idx));
  }, [setSuggestedFields]);

  const addSuggestion = useCallback(() => {
    setSuggestedFields((prev) => [...prev, { name: "", type: "text", description: "" }]);
  }, [setSuggestedFields]);

  const moveSuggestion = useCallback((idx: number, dir: -1 | 1) => {
    setSuggestedFields((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, [setSuggestedFields]);

  // ── AI suggest fields ──────────────────────────────────────────────────────
  const suggestFields = async () => {
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");
    if (fileStates.length === 0) return toast.error("Upload at least one file first.");

    setIsSuggesting(true);
    try {
      const limit = pLimit(systemSettings.maxConcurrency || 5);
      const settled = await Promise.allSettled(
        fileStates.map((fs) => limit(() =>
          dispatchDocumentAnalyze({
            file: fs.file,
            provider: activeModel.providerId,
            model: activeModel.defaultModel,
            apiKey: activeModel.apiKey || "",
            baseUrl: activeModel.baseUrl,
            hint: customPrompt.trim() || undefined,
          })
        ))
      );

      const validTypes = new Set(COLUMN_TYPES);
      const merged = new Map<string, SuggestedField>();
      let failed = 0;
      for (const r of settled) {
        if (r.status !== "fulfilled") { failed++; continue; }
        const fields = (r.value.fields as Array<{ name: string; type: string; description?: string }> | undefined) ?? [];
        for (const f of fields) {
          const key = (f.name || "").trim().toLowerCase();
          if (!key || merged.has(key)) continue;
          merged.set(key, {
            name: f.name,
            type: validTypes.has(f.type as SuggestedField["type"]) ? (f.type as SuggestedField["type"]) : "text",
            description: f.description || "",
          });
        }
      }

      if (merged.size === 0) {
        toast.error("Could not parse AI suggestions. Try again.");
        return;
      }

      setSuggestedFields(Array.from(merged.values()));
      setHasSuggestedOnce(true);
      const analyzed = fileStates.length - failed;
      toast.success(`${merged.size} fields suggested from ${analyzed} file${analyzed !== 1 ? "s" : ""}${failed > 0 ? ` (${failed} failed)` : ""}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Suggestion failed", { description: msg });
    } finally {
      setIsSuggesting(false);
    }
  };

  // ── From imported file ─────────────────────────────────────────────────────
  const handleTemplateFile = useCallback((data: Record<string, unknown>[]) => {
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
  }, [setSuggestedFields]);

  // ── From pasted CSV text ───────────────────────────────────────────────────
  const extractFromPastedCsv = useCallback(() => {
    if (!csvPasteText.trim()) {
      setSuggestedFields(EMPTY_SUGGESTED);
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
      setSuggestedFields(EMPTY_SUGGESTED);
      setCsvPasteText("");
      setPasteExtracted(true);
      return;
    }
    if (warnings.length > 0) toast.warning(warnings.join("\n"));
    setSuggestedFields(fields);
    setCsvPasteText("");
    setPasteExtracted(true);
    toast.success(`${fields.length} columns extracted`);
  }, [csvPasteText, setSuggestedFields]);

  // ── File drop ──────────────────────────────────────────────────────────────
  const onDrop = useCallback(
    (accepted: File[]) => {
      const valid = accepted.filter((f) => getFileTypeKey(f) !== null);
      const skipped = accepted.length - valid.length;
      if (skipped > 0) toast.warning(`${skipped} file(s) skipped — unsupported type`);
      valid.forEach((f) => filesRef.current.set(fileKey(f), f));
      setFileStates((prev) => [
        ...prev,
        ...valid.map((f): FileState => ({ file: f, status: "pending" })),
      ]);
    },
    [setFileStates, filesRef]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: true,
  });

  const removeFile = (idx: number) => {
    const fs = fileStates[idx];
    if (fs) filesRef.current.delete(fileKey(fs.file));
    setFileStates((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Build data rows from files ─────────────────────────────────────────────
  const data: Row[] = useMemo(() =>
    fileStates.map((fs, i) => ({
      _fileIdx: i,
      document_name: fs.file.name,
      _fileKey: fileKey(fs.file),
    })),
    [fileStates]
  );

  // ── Batch processor ───────────────────────────────────────────────────────
  const batch = useBatchProcessor({
    toolId: "/process-documents",
    runType: "process-documents",
    activeModel,
    systemSettings,
    data,
    dataName: fileStates.map((f) => f.file.name).join(", ") || "unnamed",
    systemPrompt: aiInstructions || buildSystemPrompt(),
    validate: () => {
      if (fileStates.length === 0) return "Upload at least one file";
      if (!customPrompt.trim()) return "Enter processing instructions first";
      if (isStructured) {
        const named = suggestedFields.filter((c) => c.name.trim());
        if (named.length === 0) return "Define at least one column.";
      }
      return null;
    },
    selectData: (_data: Row[], mode) => {
      return mode === "test" ? _data.slice(0, 1) : _data;
    },
    processRow: async (row: Row) => {
      const fKey = row._fileKey as string;
      const file = filesRef.current.get(fKey);
      if (!file) throw new Error(`File not found: ${row.document_name}`);

      const systemPrompt = buildSystemPrompt();

      const t0 = Date.now();
      const result = await dispatchDocumentProcess({
        file,
        provider: activeModel!.providerId,
        model: activeModel!.defaultModel,
        apiKey: activeModel!.apiKey || "",
        baseUrl: activeModel!.baseUrl,
        systemPrompt,
        maxTokens: systemSettings.maxTokens ?? undefined,
      });

      const latency = Date.now() - t0;
      if (result.chunks > 1) {
        const msg = result.failedChunks > 0
          ? `Processed ${file.name} in ${result.chunks} sections (${result.failedChunks} failed)`
          : `Processed ${file.name} in ${result.chunks} sections`;
        toast.info(msg);
      }

      return {
        document_name: file.name,
        output: result.text,
        ...(outputFormat === "csv" || outputFormat === "json" ? { _all_records: result.text } : {}),
        _format: outputFormat,
        _chunk_count: result.chunks,
        status: "success",
        latency_ms: latency,
      };
    },
    buildResultEntry: (r: Row, i: number) => ({
      rowIndex: i,
      input: { document_name: r.document_name } as Record<string, unknown>,
      output: (r.output as string) ?? "",
      status: (r.status as string) ?? "success",
      latency: r.latency_ms as number | undefined,
      errorMessage: r.error_msg as string | undefined,
    }),
    onComplete: () => {},
  });

  // ── Session restore from history ──────────────────────────────────────────
  const restored = useRestoreSession("process-documents");
  useEffect(() => {
    if (!restored) return;
    queueMicrotask(() => {
      const sp = restored.systemPrompt ?? "";

      // Detect output format from saved system prompt
      const fmt: OutputFormat = sp.includes("Return ONLY raw CSV") ? "csv"
        : sp.includes("Return ONLY a JSON array") ? "json"
        : sp.includes("Return Markdown") ? "md"
        : sp.includes("Return Moodle GIFT format") ? "gift"
        : "txt";
      setOutputFormat(fmt);

      // Restore AI instructions and custom prompt
      setAiInstructions(sp);
      const instrMatch = sp.match(/USER INSTRUCTIONS:\n([\s\S]*?)(?:\n\n(?:SCHEMA|OUTPUT FORMAT):|$)/);
      if (instrMatch) setCustomPrompt(instrMatch[1].trim());

      // Restore schema/columns (same format as generate)
      const schemaMatch = sp.match(/SCHEMA:\n([\s\S]*?)(?:\n\n|$)/);
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

      // Restore file list as placeholder entries (real File contents can't be
      // serialized — names only, mirrors Extract Data's restore behavior).
      const placeholderFiles: FileState[] = restored.data.map((row) => {
        const name = (row.document_name as string) || "document";
        const placeholder = new File([], name);
        filesRef.current.set(fileKey(placeholder), placeholder);
        return { file: placeholder, status: "done" as const };
      });
      setFileStates(placeholderFiles);

      // Populate results in global processing store
      const errors = restored.results.filter((r) => r.status === "error").length;
      useProcessingStore.getState().completeJob(
        "/process-documents",
        restored.results,
        { success: restored.results.length - errors, errors, avgLatency: 0 },
        restored.runId,
      );
      toast.success(`Restored session: ${restored.results.length} document(s)`);
    });
  }, [restored, setOutputFormat, setAiInstructions, setCustomPrompt, setFileStates, filesRef, setSuggestedFields, setHasSuggestedOnce]);

  const fileStatuses = useFileStatuses(fileStates, batch.results);

  // ── Build results for display ─────────────────────────────────────────────
  const resultFormat = useMemo(() => {
    const first = batch.results.find((r) => r.status === "success");
    return (first?._format as string) ?? null;
  }, [batch.results]);
  const isTabularResult = resultFormat === "csv";
  const isJsonResult = resultFormat === "json";

  const allResults: DocResult[] = useMemo(() => {
    return batch.results
      .filter((r) => r.status === "success" && r.output)
      .map((r) => ({
        document_name: r.document_name as string,
        output: r.output as string,
      }));
  }, [batch.results]);

  const tableResults: Row[] = useMemo(() => {
    if (!isTabularResult && !isJsonResult) return [];
    const rows: Row[] = [];

    const parseCsvRow = (line: string): string[] => {
      const values: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
          else { inQuotes = !inQuotes; }
        } else if (ch === "," && !inQuotes) {
          values.push(current); current = "";
        } else {
          current += ch;
        }
      }
      values.push(current);
      return values.map((v) => v.trim());
    };

    for (const r of batch.results) {
      if (r.status !== "success" || !r._all_records) continue;
      const raw = (r._all_records as string)
        .replace(/^```(?:csv|json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
      const docName = r.document_name as string;

      if (resultFormat === "json") {
        try {
          const parsed = JSON.parse(raw);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          for (const obj of arr) {
            if (obj && typeof obj === "object") {
              rows.push({ document_name: docName, ...(obj as Record<string, unknown>) });
            }
          }
        } catch {
          // Unparseable — skip; raw fallback will handle it
        }
      } else {
        const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          const headers = parseCsvRow(lines[0]);
          for (let li = 1; li < lines.length; li++) {
            const values = parseCsvRow(lines[li]);
            const row: Row = { document_name: docName };
            headers.forEach((h, i) => { if (h) row[h] = values[i] ?? ""; });
            rows.push(row);
          }
        }
      }
    }
    return rows;
  }, [batch.results, isTabularResult, isJsonResult, resultFormat]);

  // Aggregated JSON blob for the raw-output view (mirrors Generate's single blob)
  const aggregatedJsonRaw = useMemo(() => {
    if (!isJsonResult || tableResults.length === 0) return "";
    return JSON.stringify(tableResults, null, 2);
  }, [isJsonResult, tableResults]);

  // Pretty-print output per-document for the card fallback view
  const prettyOutput = useCallback((raw: string): string => {
    if (resultFormat === "json") {
      try {
        const cleaned = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
        return JSON.stringify(JSON.parse(cleaned), null, 2);
      } catch {
        return raw;
      }
    }
    return raw;
  }, [resultFormat]);

  // ── Export (text formats only — CSV/Excel uses ExportDropdown) ───────────────
  const handleExportText = () => {
    if (allResults.length === 0) return;
    const fname = "processed_documents";

    switch (outputFormat) {
      case "json": {
        const blob = new Blob([JSON.stringify(allResults, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fname}.json`;
        a.click();
        URL.revokeObjectURL(url);
        break;
      }
      case "txt":
        downloadText(allResults, fname);
        break;
      case "md":
        downloadMarkdown(allResults, fname);
        break;
      case "gift":
        downloadText(allResults, `${fname}.gift`);
        break;
    }
  };

  // ── Copy to clipboard ─────────────────────────────────────────────────────
  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const aiSectionNumber = isStructured ? 5 : 4;
  const executeSectionNumber = isStructured ? 6 : 5;

  const totalChunks = batch.results.reduce((sum, r) => sum + (Number(r._chunk_count) || 1), 0);
  const chunkNote = totalChunks > allResults.length ? ` (${totalChunks} sections)` : "";
  const processSubtitle = `${tableResults.length} rows from ${allResults.length} document${allResults.length !== 1 ? "s" : ""}${chunkNote}`;

  const renderSchemaTable = () => (
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
        <Button variant="outline" size="sm" className="text-xs text-destructive hover:bg-destructive/10" onClick={() => setSuggestedFields(EMPTY_SUGGESTED)}>
          <Trash2 className="h-3 w-3 mr-2" /> Clear All
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">Process Documents</h1>
          <p className="text-muted-foreground text-sm">
            Upload documents, write instructions, and get free-form AI output
          </p>
        </div>
        <Button variant="destructive" className="gap-2 px-5" onClick={() => {
          clearSessionKeys("procdocs2_");
          batch.clearResults();
          filesRef.current.clear();
          setFileStates([]);
          setCustomPrompt("");
          setOutputFormat("txt");
          setAiInstructions("");
          setSuggestedFields(EMPTY_SUGGESTED);
          setHasSuggestedOnce(false);
          setColumnMode("suggest");
          setFileExtracted(false);
          setPasteExtracted(false);
        }}>
            <RotateCcw className="h-3.5 w-3.5" /> Start Over
          </Button>
      </div>

      <div className={batch.isProcessing ? "pointer-events-none opacity-60" : ""}>
      {/* ── 1. Upload Documents ─────────────────────────────────────────── */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Upload Documents</h2>

        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/20"
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {isDragActive ? "Drop files here..." : "Drop files here or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            PDF, DOCX, Excel, TXT, MD, JSON, CSV, HTML
          </p>
        </div>

        {fileStates.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">{fileStates.length} file{fileStates.length !== 1 ? "s" : ""}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => { filesRef.current.clear(); setFileStates([]); batch.clearResults(); toast.success("Cleared all files"); }}>
                <Trash2 className="h-3 w-3 mr-1" /> Clear All
              </Button>
            </div>
            {fileStates.map((entry, idx) => {
              const status = batch.isProcessing || batch.results.length > 0 ? fileStatuses[idx] : entry.status;
              const resultRow = batch.results[idx];
              const errorMsg = resultRow?.error_msg as string | undefined;
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-muted/20">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate text-xs">{entry.file.name}</span>
                    {entry.file.size === 0 ? (
                      <span className="text-[10px] text-red-600 dark:text-red-400 shrink-0 italic" title="Restored placeholder — original file contents are not stored. Re-upload the file to re-run.">
                        Placeholder · re-upload to re-run
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {(entry.file.size / 1024).toFixed(0)} KB
                      </span>
                    )}

                    {status === "pending" && isLikelyChunked(entry.file.size) && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0" title="This file will be split into sections for complete processing">
                        Multi-section
                      </span>
                    )}
                    {status === "pending" && !isLikelyChunked(entry.file.size) && (
                      <span className="text-[10px] text-muted-foreground shrink-0">Pending</span>
                    )}
                    {(status === "extracting" || status === "analyzing") && (
                      <span className="flex items-center gap-1 text-[10px] text-purple-600 shrink-0">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing
                      </span>
                    )}
                    {status === "done" && (
                      <span className="flex items-center gap-1 text-[10px] text-green-600 shrink-0">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Done
                      </span>
                    )}
                    {status === "error" && (
                      <span className="flex items-center gap-1 text-[10px] text-red-500 shrink-0" title={errorMsg}>
                        <AlertCircle className="h-3.5 w-3.5" /> Error
                      </span>
                    )}

                    <button onClick={() => removeFile(idx)} className="text-muted-foreground hover:text-destructive shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {status === "error" && errorMsg && (
                    <div className="ml-3 text-[10px] text-red-500 leading-snug">{errorMsg}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t" />

      {/* ── 2. Instructions ───────────────────────────────────────────── */}
      <div className="space-y-3 py-8">
        <h2 className="text-2xl font-bold">2. Instructions</h2>
        <PromptEditor
          value={customPrompt}
          onChange={setCustomPrompt}
          placeholder="What should the AI do with your documents? E.g.: Summarize this document in 3 bullet points..."
          examplePrompts={SAMPLE_PROMPTS}
          label="Processing Instructions"
          helpText="Describe how you want each document processed. This applies to every uploaded file."
        />
      </div>

      <div className="border-t" />

      {/* ── 3. Output Format ──────────────────────────────────────────── */}
      <div className="space-y-3 py-8">
        <h2 className="text-2xl font-bold">3. Output Format</h2>
        <div className="grid grid-cols-2 gap-6">
          {/* Structured Data */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Structured Data</p>
            {([
              { value: "csv" as const, label: "CSV/Excel", desc: "Tabular rows and columns — best for spreadsheets and data analysis" },
              { value: "json" as const, label: "JSON", desc: "Structured key-value data — best for APIs and nested content" },
            ]).map(({ value, label, desc }) => (
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
              { value: "txt" as const, label: "Free Text", desc: "Plain text output — best for summaries and free-form answers" },
              { value: "md" as const, label: "Markdown", desc: "Formatted text with headings, lists, and emphasis — best for reports" },
              { value: "gift" as const, label: "GIFT (Moodle)", desc: "Moodle quiz format — generates questions importable into Moodle LMS" },
            ]).map(({ value, label, desc }) => (
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

      {/* ── 4. Define Columns (structured only) ──────────────────────────── */}
      {isStructured && (<>
        <div className="border-t" />
        <div className="space-y-4 py-8">
          <h2 className="text-2xl font-bold">4. Define Columns</h2>
          <p className="text-sm text-muted-foreground -mt-2">
            Define the columns the AI should extract from each document. Use AI to suggest columns from your instructions, or add them manually.
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
              {renderSchemaTable()}
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
                setSuggestedFields(EMPTY_SUGGESTED);
              }}>
                <Upload className="h-3.5 w-3.5 mr-1.5" /> {fileExtracted ? "Re-import" : "Import"}
              </Button>
              {renderSchemaTable()}
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
                setSuggestedFields(EMPTY_SUGGESTED);
              }}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
              </Button>
              {renderSchemaTable()}
            </>
          )}
        </div>
      </>)}

      <div className="border-t" />

      {/* ── AI Instructions ─────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={aiSectionNumber}
        value={aiInstructions}
        onChange={setAiInstructions}
      >
        <NoModelWarning activeModel={activeModel} />
      </AIInstructionsSection>

      </div>

      <div className="border-t" />

      {/* ── Execute ──────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">{executeSectionNumber}. Execute</h2>

        {fileStates.some((fs) => isLikelyChunked(fs.file.size)) && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 text-sm text-amber-700 dark:text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Some files are large and will be automatically split into sections for complete processing.
              This uses additional API calls but ensures no content is missed.
            </span>
          </div>
        )}

        <ExecutionPanel
          isProcessing={batch.isProcessing}
          aborting={batch.aborting}
          runMode={batch.runMode}
          progress={batch.progress}
          etaStr={batch.etaStr}
          dataCount={fileStates.length}
          disabled={
            fileStates.length === 0
            || !activeModel
            || !customPrompt.trim()
            || (isStructured && !suggestedFields.some((c) => c.name.trim()))
          }
          onRun={batch.run}
          onAbort={batch.abort}
          onResume={batch.resume}
          onCancel={batch.clearResults}
          failedCount={batch.failedCount}
          skippedCount={batch.skippedCount}
          unitLabel="file"
          testLabel="Test (1 file)"
          fullLabel={`Process All (${fileStates.length} file${fileStates.length !== 1 ? "s" : ""})`}
        />
      </div>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {isTabularResult && tableResults.length > 0 ? (
        <ResultsPanel
          results={tableResults}
          runId={batch.runId}
          title="Results"
          subtitle={processSubtitle}
        />
      ) : isJsonResult && aggregatedJsonRaw ? (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Results</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tableResults.length} object{tableResults.length !== 1 ? "s" : ""} from {allResults.length} document{allResults.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {batch.runId && (
                <Link href={`/history/${batch.runId}`} className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  View in History
                </Link>
              )}
              <Button variant="outline" className="gap-2 px-5" onClick={() => {
                const blob = new Blob([aggregatedJsonRaw], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = `processed_documents_${Date.now()}.json`; a.click();
                URL.revokeObjectURL(url);
              }}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Download
              </Button>
            </div>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-muted/20 text-xs font-medium text-muted-foreground">Raw output</div>
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{aggregatedJsonRaw}</pre>
          </div>
        </div>
      ) : allResults.length > 0 && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Results</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {allResults.length} document{allResults.length !== 1 ? "s" : ""} processed
              </p>
            </div>
            <div className="flex items-center gap-3">
              {batch.runId && (
                <Link
                  href={`/history/${batch.runId}`}
                  className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View in History
                </Link>
              )}
              {resultFormat && (
                <Button variant="outline" size="sm" className="text-xs" onClick={handleExportText}>
                  Export as {resultFormat === "json" ? "JSON" : resultFormat === "md" ? "Markdown" : resultFormat === "gift" ? "GIFT" : "Text"}
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {allResults.map((result, idx) => (
              <div key={idx} className="border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{result.document_name}</span>
                  <button
                    onClick={() => copyToClipboard(result.output, idx)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copiedIdx === idx ? (
                      <><Check className="h-3 w-3 text-green-600" /> Copied</>
                    ) : (
                      <><Copy className="h-3 w-3" /> Copy</>
                    )}
                  </button>
                </div>
                <div className="p-4">
                  <pre className={`whitespace-pre-wrap text-sm leading-relaxed ${resultFormat === "json" || resultFormat === "gift" ? "font-mono text-xs" : "font-sans"}`}>{prettyOutput(result.output)}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
