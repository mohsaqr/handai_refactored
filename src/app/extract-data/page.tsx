"use client";

import React, { useState, useCallback, useRef, useMemo } from "react";
import { useDropzone } from "react-dropzone";
import { DataTable, ExportDropdown } from "@/components/tools/DataTable";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PromptEditor } from "@/components/tools/PromptEditor";
import { Input } from "@/components/ui/input";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { ExecutionPanel } from "@/components/tools/ExecutionPanel";
import { ResultsPanel } from "@/components/tools/ResultsPanel";
import {
  FileText,
  Upload,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plus,
  Sparkles,
  Trash2,
  RotateCcw,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { toast } from "sonner";
import type { FieldDef, FileState } from "@/types";
import { dispatchDocumentExtract, dispatchDocumentAnalyze } from "@/lib/llm-dispatch";
import { getPrompt, formatExtractionSchema } from "@/lib/prompts";

// ─── Constants ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const FIELD_TYPES: FieldDef["type"][] = ["text", "number", "date", "boolean", "list"];

const SAMPLE_EXTRACTION_PROMPTS: Record<string, string> = {
  "Invoice details": "Extract invoice details: invoice number, date, vendor name, line items with quantities and prices, and total amount.",
  "Meeting minutes": "Extract meeting minutes: date, attendees, agenda items, decisions made, action items with owners and due dates.",
  "Research findings": "Extract research findings: research question, methodology, key results, conclusions, and limitations.",
  "Contract key terms": "Extract contract key terms: parties involved, obligations, payment terms, termination conditions, and important clauses.",
  "Resume / CV data": "Extract candidate information: name, contact details, education history, work experience, and skills.",
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ExtractDataPage() {
  const activeModel = useActiveModel();
  const systemSettings = useSystemSettings();

  // ── Section 1: Documents
  const [fileStates, setFileStates] = useSessionState<FileState[]>("extractdata_fileStates", []);
  // File objects can't be serialized — keep them in a ref keyed by name+size
  const filesRef = useRef<Map<string, File>>(new Map());

  const fileKey = (f: File) => `${f.name}__${f.size}`;

  // ── Section 2: Describe Data
  const [customPrompt, setCustomPrompt] = useSessionState("extractdata_customPrompt", "");

  // ── Section 3: Define Columns
  const [fields, setFields] = useSessionState<FieldDef[]>("extractdata_fields", [
    { name: "", type: "text", description: "" },
    { name: "", type: "text", description: "" },
    { name: "", type: "text", description: "" },
  ]);
  const [analyzing, setAnalyzing] = useState(false);
  const [hasSuggestedOnce, setHasSuggestedOnce] = useSessionState("extractdata_hasSuggestedOnce", false);

  // ── Column helpers ──
  const updateField = useCallback((idx: number, updates: Partial<FieldDef>) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  }, [setFields]);

  const removeField = useCallback((idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  }, [setFields]);

  const addField = useCallback(() => {
    setFields((prev) => [...prev, { name: "", type: "text", description: "" }]);
  }, [setFields]);

  const moveField = useCallback((idx: number, dir: -1 | 1) => {
    setFields((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, [setFields]);

  // ── Auto-generate AI Instructions ──────────────────────────────────────────
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a document data extractor. Extract structured information from documents.");
    lines.push("");

    if (customPrompt.trim()) {
      lines.push("EXTRACTION DESCRIPTION:");
      lines.push(customPrompt.trim());
      lines.push("");
    }

    const namedFields = fields.filter((f) => f.name.trim());
    if (namedFields.length > 0) {
      lines.push("FIELDS TO EXTRACT:");
      namedFields.forEach((f) => {
        lines.push(`- ${f.name} (${f.type})${f.description ? `: ${f.description}` : ""}`);
      });
      lines.push("");
    }

    lines.push("RULES:");
    lines.push("- Extract data from the document content");
    lines.push("- Return a JSON object with the defined field names as keys");
    lines.push("- If a field cannot be found, return null for that field");
    lines.push("- Do not include markdown or code fences");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [customPrompt, fields]);

  // ── Section 4: AI Instructions
  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  // ── System prompt ──────────────────────────────────────────────────────────
  const buildSystemPrompt = (): string => {
    if (aiInstructions.trim()) return aiInstructions;
    const namedFields = fields.filter((f) => f.name.trim());
    if (namedFields.length > 0) {
      return getPrompt("document.extraction").replace("{schema}", formatExtractionSchema(namedFields));
    }
    return (
      customPrompt.trim() ||
      getPrompt("document.extraction").replace(
        "{schema}",
        "(no schema defined — extract all logical records with appropriate column names)"
      )
    );
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

  // ── AI Suggest ─────────────────────────────────────────────────────────────
  const suggestFields = async () => {
    if (fileStates.length === 0) return toast.error("Upload at least one file first");
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");

    setAnalyzing(true);
    try {
      const sampleFile = fileStates[0].file;
      const result = await dispatchDocumentAnalyze({
        file: sampleFile,
        provider: activeModel.providerId,
        model: activeModel.defaultModel,
        apiKey: activeModel.apiKey || "",
        baseUrl: activeModel.baseUrl,
        hint: customPrompt.trim() || undefined,
      });

      if (result.fields?.length > 0) {
        const validTypes = new Set(FIELD_TYPES);
        const mapped: FieldDef[] = result.fields.map((f: FieldDef) => ({
          name: f.name || "",
          type: validTypes.has(f.type) ? f.type : "text",
          description: f.description || "",
        }));
        setFields(mapped);
        setHasSuggestedOnce(true);
        toast.success(`${mapped.length} fields suggested`);
      } else {
        toast.info("No suggestions returned. Try with a more structured document.");
      }
    } catch (err: unknown) {
      toast.error("Analysis failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Build data rows from files (one row per file for useBatchProcessor) ────
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
    toolId: "/extract-data",
    runType: "extract-data",
    activeModel,
    systemSettings,
    data,
    dataName: fileStates.map((f) => f.file.name).join(", ") || "unnamed",
    systemPrompt: aiInstructions || buildSystemPrompt(),
    validate: () => {
      if (fileStates.length === 0) return "Upload at least one file";
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
      const namedFields = fields.filter((f) => f.name.trim());

      const t0 = Date.now();
      const result = await dispatchDocumentExtract({
        file,
        provider: activeModel!.providerId,
        model: activeModel!.defaultModel,
        apiKey: activeModel!.apiKey || "",
        baseUrl: activeModel!.baseUrl,
        systemPrompt,
        fields: namedFields.length > 0 ? namedFields : undefined,
      });

      const latency = Date.now() - t0;
      // Flatten first record into the row; store all records as JSON for full export
      const firstRecord = result.records?.[0] ?? {};
      return {
        document_name: file.name,
        ...firstRecord,
        _all_records: JSON.stringify(result.records ?? []),
        _record_count: result.count,
        status: "success",
        latency_ms: latency,
      };
    },
    buildResultEntry: (r: Row, i: number) => ({
      rowIndex: i,
      input: { document_name: r.document_name } as Record<string, unknown>,
      output: (r._all_records as string) ?? JSON.stringify(r),
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

  // ── Build flat table from all records ─────────────────────────────────────
  const allResults: Row[] = useMemo(() => {
    const rows: Row[] = [];
    for (const r of batch.results) {
      if (r.status !== "success" || !r._all_records) continue;
      try {
        const records = JSON.parse(r._all_records as string) as Row[];
        for (const rec of records) {
          rows.push({ document_name: r.document_name, ...rec });
        }
      } catch {
        // skip unparseable
      }
    }
    return rows;
  }, [batch.results]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">Extract Data</h1>
          <p className="text-muted-foreground text-sm">
            Extract structured tabular data from documents using AI
          </p>
        </div>
        {fileStates.length > 0 && (
          <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("extractdata_"); batch.clearResults(); filesRef.current.clear(); setFileStates([]); setCustomPrompt(""); setFields([{ name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }, { name: "", type: "text", description: "" }]); setHasSuggestedOnce(false); setAiInstructions(""); }}>
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
              const recordCount = resultRow?._record_count as number | undefined;
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
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing
                      </span>
                    )}
                    {status === "done" && (
                      <span className="flex items-center gap-1 text-[10px] text-green-600 shrink-0">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {recordCount ?? 0} records
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

      {/* ── 2. Extraction Prompt ─────────────────────────────────────────── */}
      <div className="space-y-3 py-8">
        <h2 className="text-2xl font-bold">2. Extraction Prompt</h2>
        <PromptEditor
          value={customPrompt}
          onChange={setCustomPrompt}
          placeholder="Describe what you want to extract from the documents. E.g.: Extract invoice details including amounts, dates, and vendor names..."
          examplePrompts={SAMPLE_EXTRACTION_PROMPTS}
          label="Instructions"
          helpText="Describe the data you want to extract. This feeds into the AI instructions and helps the AI suggest columns."
        />
      </div>

      <div className="border-t" />

      {/* ── 3. Define Columns ──────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Define Columns</h2>
        <p className="text-sm text-muted-foreground -mt-2">
          Define your output columns. Use AI to suggest columns from your document, or add them manually.
        </p>

        <div className="flex gap-2">
          {hasSuggestedOnce ? (
            <Button variant="outline" size="sm" className="text-xs" onClick={suggestFields} disabled={analyzing}>
              {analyzing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              Regenerate with AI
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="text-xs" onClick={suggestFields} disabled={analyzing}>
              {analyzing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              Suggest with AI
            </Button>
          )}
        </div>

        {analyzing && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing document for field suggestions...
          </div>
        )}

        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">Column Schema</div>
          <div className="p-3 space-y-2">
            {fields.map((field, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <div className="flex flex-col shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => moveField(idx, -1)}
                    disabled={idx === 0}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => moveField(idx, 1)}
                    disabled={idx === fields.length - 1}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
                <Input
                  placeholder="column_name"
                  value={field.name}
                  onChange={(e) => updateField(idx, { name: e.target.value })}
                  className="flex-1 h-8 text-xs"
                />
                <Select
                  value={field.type}
                  onValueChange={(v) => updateField(idx, { type: v as FieldDef["type"] })}
                >
                  <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Description (optional)"
                  value={field.description || ""}
                  onChange={(e) => updateField(idx, { description: e.target.value })}
                  className="flex-1 h-8 text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeField(idx)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="px-3 pb-3">
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={addField}>
              <Plus className="h-3 w-3 mr-2" /> Add Column
            </Button>
          </div>
        </div>
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
          disabled={fileStates.length === 0 || !activeModel}
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
              <h2 className="text-lg font-semibold">Extracted Data</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {allResults.length} records from {batch.results.filter((r) => r.status === "success").length} file(s)
              </p>
            </div>
            <div className="flex items-center gap-3">
              <ExportDropdown data={allResults} filename="extracted_documents" />
            </div>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <DataTable data={allResults} />
          </div>
        </div>
      )}
    </div>
  );
}
