"use client";

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useFilesRef, useFileStatuses, fileKey } from "@/hooks/useFilesRef";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { ResultsPanel } from "@/components/tools/ResultsPanel";
import { PromptEditor } from "@/components/tools/PromptEditor";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useRestoreSession } from "@/hooks/useRestoreSession";
import { useProcessingStore } from "@/lib/processing-store";
import { ExecutionPanel } from "@/components/tools/ExecutionPanel";
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
} from "lucide-react";
import { toast } from "sonner";
import type { FileState } from "@/types";
import { dispatchDocumentProcess } from "@/lib/llm-dispatch";
import { downloadText, downloadMarkdown } from "@/lib/export";

// ─── Constants ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

type OutputFormat = "csv" | "json" | "txt" | "md" | "gift";

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

interface DocResult {
  document_name: string;
  output: string;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProcessDocumentsPage() {
  const activeModel = useActiveModel();
  const systemSettings = useSystemSettings();

  // ── Section 1: Documents
  const [fileStates, setFileStates] = useSessionState<FileState[]>("procdocs2_fileStates", []);
  const filesRef = useFilesRef();

  // ── Section 2: Output Format
  const [outputFormat, setOutputFormat] = useSessionState<OutputFormat>("procdocs2_outputFormat", "txt");

  // ── Section 3: Instructions
  const [customPrompt, setCustomPrompt] = useSessionState("procdocs2_customPrompt", "");

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

    lines.push("OUTPUT FORMAT:");
    if (outputFormat === "csv") {
      lines.push("- Return ONLY raw CSV. Row 1: header. Rows 2+: one record per row.");
      lines.push("- Wrap fields containing commas or line breaks in double quotes.");
      lines.push("- STRICTLY FORBIDDEN: markdown, code blocks, JSON, explanations, or prose.");
    } else if (outputFormat === "json") {
      lines.push("- Return ONLY a JSON array of objects. Nothing else.");
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
  }, [customPrompt, outputFormat]);

  // ── Section 4: AI Instructions
  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // ── System prompt ──────────────────────────────────────────────────────────
  const buildSystemPrompt = (): string => {
    if (aiInstructions.trim()) return aiInstructions;
    if (customPrompt.trim()) return `You are a document processing assistant.\n\nINSTRUCTIONS:\n${customPrompt.trim()}\n\nReturn only the requested output. No preamble or commentary.`;
    return "You are a document processing assistant. Process the document according to the user's instructions. Return your response as plain text.";
  };

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
      });

      const latency = Date.now() - t0;

      return {
        document_name: file.name,
        output: result.text,
        ...(outputFormat === "csv" ? { _all_records: result.text } : {}),
        _format: outputFormat,
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
      // Detect output format from saved system prompt
      const sp = restored.systemPrompt ?? "";
      const fmt: OutputFormat = sp.includes("Return ONLY raw CSV") ? "csv"
        : sp.includes("Return ONLY a JSON array") ? "json"
        : sp.includes("Return Markdown") ? "md"
        : sp.includes("Return Moodle GIFT format") ? "gift"
        : "txt";
      setOutputFormat(fmt);

      // Restore AI instructions and custom prompt
      setAiInstructions(sp);
      const instrMatch = sp.match(/USER INSTRUCTIONS:\n([\s\S]*?)(?:\n\nOUTPUT FORMAT:|$)/);
      if (instrMatch) setCustomPrompt(instrMatch[1].trim());

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
  }, [restored, setOutputFormat, setAiInstructions, setCustomPrompt, setFileStates, filesRef]);

  const fileStatuses = useFileStatuses(fileStates, batch.results);

  // ── Build results for display ─────────────────────────────────────────────
  // Use the format that was active when processing ran, not the current radio selection
  const resultFormat = useMemo(() => {
    const first = batch.results.find((r) => r.status === "success");
    return (first?._format as string) ?? null;
  }, [batch.results]);
  const isTabular = resultFormat === "csv";

  // Text results (for text/markdown/gift/json display)
  const allResults: DocResult[] = useMemo(() => {
    return batch.results
      .filter((r) => r.status === "success" && r.output)
      .map((r) => ({
        document_name: r.document_name as string,
        output: r.output as string,
      }));
  }, [batch.results]);

  // Parsed tabular results (for CSV/Excel display — parses LLM CSV output into rows)
  const tableResults: Row[] = useMemo(() => {
    if (!isTabular) return [];
    const rows: Row[] = [];
    for (const r of batch.results) {
      if (r.status !== "success" || !r._all_records) continue;
      const raw = (r._all_records as string)
        .replace(/^```(?:csv|json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();

      const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
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
        const headers = parseCsvRow(lines[0]);
        for (let li = 1; li < lines.length; li++) {
          const values = parseCsvRow(lines[li]);
          const row: Row = { document_name: r.document_name as string };
          headers.forEach((h, i) => { if (h) row[h] = values[i] ?? ""; });
          rows.push(row);
        }
      }
    }
    return rows;
  }, [batch.results, isTabular]);

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
        <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("procdocs2_"); batch.clearResults(); filesRef.current.clear(); setFileStates([]); setCustomPrompt(""); setOutputFormat("txt"); setAiInstructions(""); }}>
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

                    {status === "pending" && (
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

      {/* ── 2. Output Format ──────────────────────────────────────────── */}
      <div className="space-y-3 py-8">
        <h2 className="text-2xl font-bold">2. Output Format</h2>
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

      <div className="border-t" />

      {/* ── 3. Instructions ───────────────────────────────────────────── */}
      <div className="space-y-3 py-8">
        <h2 className="text-2xl font-bold">3. Instructions</h2>
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

      {/* ── 4. AI Instructions ─────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={4}
        value={aiInstructions}
        onChange={setAiInstructions}
      >
        <NoModelWarning activeModel={activeModel} />
      </AIInstructionsSection>

      </div>

      <div className="border-t" />

      {/* ── 5. Execute ──────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">5. Execute</h2>
        <ExecutionPanel
          isProcessing={batch.isProcessing}
          aborting={batch.aborting}
          runMode={batch.runMode}
          progress={batch.progress}
          etaStr={batch.etaStr}
          dataCount={fileStates.length}
          disabled={fileStates.length === 0 || !activeModel || !customPrompt.trim()}
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
      {isTabular && tableResults.length > 0 ? (
        <ResultsPanel
          results={tableResults}
          runId={batch.runId}
          title="Results"
          subtitle={`${tableResults.length} rows from ${allResults.length} document${allResults.length !== 1 ? "s" : ""}`}
        />
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
                  <pre className={`whitespace-pre-wrap text-sm leading-relaxed ${resultFormat === "json" ? "font-mono" : "font-sans"}`}>{result.output}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
