"use client";

import React, { useState, useCallback, useRef, useMemo } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { PromptEditor } from "@/components/tools/PromptEditor";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
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
import { downloadCSV, downloadXLSX, downloadText, downloadMarkdown } from "@/lib/export";

// ─── Constants ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const OUTPUT_FORMATS = [
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "json", label: "JSON" },
  { value: "txt", label: "Text (.txt)" },
  { value: "md", label: "Markdown (.md)" },
] as const;

type OutputFormat = (typeof OUTPUT_FORMATS)[number]["value"];

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
  const filesRef = useRef<Map<string, File>>(new Map());
  const fileKey = (f: File) => `${f.name}__${f.size}`;

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

    lines.push("RULES:");
    lines.push("- Follow the instructions precisely");
    lines.push("- Base your response only on the document content provided");
    lines.push("- Return only the requested output — no preamble or commentary");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [customPrompt]);

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
    [setFileStates]
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

  // ── Derive file statuses from batch results ───────────────────────────────
  const fileStatuses = useMemo(() => {
    if (!batch.results.length) return fileStates.map((fs) => fs.status);
    return fileStates.map((_, i) => {
      const r = batch.results[i];
      if (!r) return "pending" as const;
      if (r.status === "error") return "error" as const;
      if (r.status === "skipped") return "pending" as const;
      if (r.status === "success") return "done" as const;
      return "pending" as const;
    });
  }, [batch.results, fileStates]);

  // ── Build results for display ─────────────────────────────────────────────
  const allResults: DocResult[] = useMemo(() => {
    return batch.results
      .filter((r) => r.status === "success" && r.output)
      .map((r) => ({
        document_name: r.document_name as string,
        output: r.output as string,
      }));
  }, [batch.results]);

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = () => {
    if (allResults.length === 0) return;
    const fname = "processed_documents";

    switch (outputFormat) {
      case "csv":
        void downloadCSV(allResults.map((r) => ({ document_name: r.document_name, output: r.output })), `${fname}.csv`);
        break;
      case "xlsx":
        void downloadXLSX(allResults.map((r) => ({ document_name: r.document_name, output: r.output })), `${fname}.xlsx`);
        break;
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
        {fileStates.length > 0 && (
          <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("procdocs2_"); batch.clearResults(); filesRef.current.clear(); setFileStates([]); setCustomPrompt(""); setOutputFormat("txt"); setAiInstructions(""); }}>
            <RotateCcw className="h-3.5 w-3.5" /> Start Over
          </Button>
        )}
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
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {(entry.file.size / 1024).toFixed(0)} KB
                    </span>

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
        <p className="text-sm text-muted-foreground -mt-1">
          Choose the export format for your processed results.
        </p>
        <div className="flex flex-wrap gap-2">
          {OUTPUT_FORMATS.map((fmt) => (
            <button
              key={fmt.value}
              onClick={() => setOutputFormat(fmt.value)}
              className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                outputFormat === fmt.value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border hover:border-primary/50 hover:bg-muted/30 text-muted-foreground"
              }`}
            >
              {fmt.label}
            </button>
          ))}
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
          unitLabel="files"
          testLabel="Test (1 file)"
          fullLabel={`Process All (${fileStates.length} file${fileStates.length !== 1 ? "s" : ""})`}
        />
      </div>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {allResults.length > 0 && (
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
              <Button variant="outline" size="sm" className="text-xs" onClick={handleExport}>
                Export as {OUTPUT_FORMATS.find((f) => f.value === outputFormat)?.label ?? outputFormat}
              </Button>
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
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">{result.output}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
