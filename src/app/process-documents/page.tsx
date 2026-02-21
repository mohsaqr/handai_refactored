"use client";

import React, { useState, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { DataTable } from "@/components/tools/DataTable";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useActiveModel } from "@/lib/hooks";
import Link from "next/link";
import {
  FileText,
  Upload,
  X,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  HelpCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { Row } from "@/types";

// ─── Types ───────────────────────────────────────────────────────────────────
interface FileEntry {
  file: File;
  name: string;
  status: "pending" | "processing" | "done" | "error";
  records?: Row[];
  error?: string;
}

// ─── Processing templates ────────────────────────────────────────────────────
const TEMPLATES: Record<string, { label: string; desc: string; prompt: string; columns: string }> = {
  custom: {
    label: "Custom",
    desc: "Create your own custom extraction template",
    prompt: "",
    columns: "column1,column2,column3",
  },
  key_points: {
    label: "Extract Key Points",
    desc: "Extract the main key points and summary from each document",
    prompt: `Extract the key points from this document.
For each key point, identify: the main claim or finding, supporting evidence, and relevance.
Return ONLY a JSON array. No explanations.`,
    columns: "key_point,supporting_evidence,relevance",
  },
  meeting_minutes: {
    label: "Meeting Minutes",
    desc: "Extract action items, decisions, and attendees from meeting notes",
    prompt: `Extract structured data from these meeting minutes.
Identify: attendees, date, agenda items, decisions made, and action items with owners.
Return ONLY a JSON array where each object is one action item or decision. No explanations.`,
    columns: "date,agenda_item,decision_or_action,owner,due_date",
  },
  research_summary: {
    label: "Research Summary",
    desc: "Summarize research papers or reports into structured fields",
    prompt: `Extract key research information from this document.
Identify: research question, methodology, key findings, conclusions, and limitations.
Return ONLY a JSON array. No explanations.`,
    columns: "research_question,methodology,key_finding,conclusion,limitation",
  },
  invoice_extraction: {
    label: "Invoice Extraction",
    desc: "Extract invoice data including items, prices, and totals",
    prompt: `Extract invoice line items from this document.
For each line item extract: item description, quantity, unit price, and total.
Also extract invoice number, date, vendor name, and total amount.
Return ONLY a JSON array where each object is one line item. No explanations.`,
    columns: "invoice_number,date,vendor,item_description,quantity,unit_price,total",
  },
  contract_summary: {
    label: "Contract Summary",
    desc: "Extract key clauses and terms from contracts",
    prompt: `Extract key contract terms and clauses from this document.
Identify: parties involved, effective date, key obligations, payment terms, termination conditions, and important clauses.
Return ONLY a JSON array. No explanations.`,
    columns: "party,obligation,payment_terms,termination_conditions,key_clause",
  },
};

// ─── File type config ─────────────────────────────────────────────────────────
const FILE_TYPE_CONFIG = [
  { key: "txt_md", label: "TXT/MD", exts: [".txt", ".md"], mime: ["text/plain", "text/markdown"] },
  { key: "pdf", label: "PDF", exts: [".pdf"], mime: ["application/pdf"] },
  { key: "docx", label: "DOCX", exts: [".docx"], mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  { key: "json_csv", label: "JSON/CSV", exts: [".json", ".csv"], mime: ["application/json", "text/csv"] },
  { key: "html_xml", label: "HTML/XML", exts: [".html", ".htm", ".xml"], mime: ["text/html", "application/xml"] },
];

const DEFAULT_ENABLED_TYPES = new Set(["txt_md", "pdf", "docx"]);

function getFileTypeKey(file: File): string | null {
  const name = file.name.toLowerCase();
  for (const ft of FILE_TYPE_CONFIG) {
    if (ft.exts.some((ext) => name.endsWith(ext))) return ft.key;
  }
  return null;
}

export default function ProcessDocumentsPage() {
  const activeModel = useActiveModel();

  // Section 1 — Select Documents
  const [inputMethod, setInputMethod] = useState<"upload" | "folder">("upload");
  const [folderPath, setFolderPath] = useState("");
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(new Set(DEFAULT_ENABLED_TYPES));
  const [files, setFiles] = useState<FileEntry[]>([]);

  // Section 2 — Processing Template
  const [templateKey, setTemplateKey] = useState("custom");
  const [processingInstructions, setProcessingInstructions] = useState("");
  const [outputColumns, setOutputColumns] = useState("column1,column2,column3");
  const [showTemplateIO, setShowTemplateIO] = useState(false);
  const [exportedTemplate, setExportedTemplate] = useState("");

  // Processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [allResults, setAllResults] = useState<Row[]>([]);

  const currentTemplate = TEMPLATES[templateKey] || TEMPLATES.custom;
  const parsedColumns = outputColumns
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const outputPreview = `document_name + ${parsedColumns.join(",") || "column1,column2,column3"}`;

  // ─── File drop ────────────────────────────────────────────────────────────
  const acceptedMime: Record<string, string[]> = {};
  FILE_TYPE_CONFIG.filter((ft) => enabledTypes.has(ft.key)).forEach((ft) => {
    ft.mime.forEach((m) => { acceptedMime[m] = ft.exts; });
  });

  const onDrop = useCallback(
    (accepted: File[]) => {
      const valid = accepted.filter((f) => {
        const key = getFileTypeKey(f);
        return key && enabledTypes.has(key);
      });
      const skipped = accepted.length - valid.length;
      if (skipped > 0) toast.warning(`${skipped} file(s) skipped — type not enabled`);
      setFiles((prev) => [
        ...prev,
        ...valid.map((f): FileEntry => ({ file: f, name: f.name, status: "pending" })),
      ]);
    },
    [enabledTypes]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: acceptedMime,
    multiple: true,
  });

  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const toggleType = (key: string) =>
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // ─── Apply template ───────────────────────────────────────────────────────
  const applyTemplate = (key: string) => {
    setTemplateKey(key);
    const t = TEMPLATES[key];
    if (t) {
      if (t.prompt) setProcessingInstructions(t.prompt);
      if (t.columns) setOutputColumns(t.columns);
    }
  };

  // ─── Process files ────────────────────────────────────────────────────────
  const canProcess = files.length > 0 || folderPath.trim().length > 0;

  const processAll = async () => {
    if (files.length === 0) return toast.error("No files uploaded");
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");

    const systemPrompt = processingInstructions.trim() ||
      `Extract data from this document into structured rows.
${parsedColumns.length > 0 ? `Output columns: ${parsedColumns.join(", ")}.` : ""}
Return ONLY a JSON array where each element has consistent field names. No explanations.`;

    setIsProcessing(true);
    const accumulated: Row[] = [];

    for (let i = 0; i < files.length; i++) {
      setFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, status: "processing" } : f));

      const entry = files[i];
      try {
        const buffer = await entry.file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );

        const fileTypeKey = getFileTypeKey(entry.file);
        const fileType = fileTypeKey?.replace("txt_md", "txt").replace("json_csv", "json").replace("html_xml", "html") ?? "txt";

        const res = await fetch("/api/document-extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileContent: base64,
            fileType,
            fileName: entry.file.name,
            provider: activeModel.providerId,
            model: activeModel.defaultModel,
            apiKey: activeModel.apiKey || "local",
            baseUrl: activeModel.baseUrl,
            systemPrompt,
          }),
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const records = (data.records as Row[]).map((r) => ({
          document_name: entry.file.name,
          ...r,
        }));

        accumulated.push(...records);
        setFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, status: "done", records } : f));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, status: "error", error: msg } : f));
        toast.error(`Failed: ${entry.file.name}`, { description: msg });
      }
    }

    setAllResults(accumulated);
    setIsProcessing(false);
    if (accumulated.length > 0) {
      toast.success(`Extracted ${accumulated.length} records from ${files.length} file(s)`);
    }
  };

  const exportCsv = () => {
    if (allResults.length === 0) return;
    const headers = [...new Set(allResults.flatMap((r) => Object.keys(r)))];
    const csv = [
      headers.join(","),
      ...allResults.map((row) =>
        headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `extracted_data_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportTemplate = () => {
    const t = {
      templateKey,
      processingInstructions,
      outputColumns,
    };
    setExportedTemplate(JSON.stringify(t, null, 2));
  };

  const importTemplate = (json: string) => {
    try {
      const t = JSON.parse(json);
      if (t.processingInstructions) setProcessingInstructions(t.processingInstructions);
      if (t.outputColumns) setOutputColumns(t.outputColumns);
      toast.success("Template imported");
    } catch {
      toast.error("Invalid template JSON");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-0 pb-16">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="pb-6 space-y-1">
        <h1 className="text-4xl font-bold">Process Documents</h1>
        <p className="text-muted-foreground text-sm">Extract structured data from documents using AI</p>
      </div>

      {/* ── Section 1: Select Documents ──────────────────────────────────── */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Select Documents</h2>

        {/* Input method radio */}
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Input Method</div>
          <div className="flex items-center gap-6">
            {(["folder", "upload"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="inputMethod"
                  value={m}
                  checked={inputMethod === m}
                  onChange={() => setInputMethod(m)}
                  className="accent-primary"
                />
                <span className="text-sm font-medium">
                  {m === "folder" ? "Folder Path" : "Upload Files"}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Folder path input */}
        {inputMethod === "folder" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <Label className="text-sm font-semibold">Folder Path</Label>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex gap-2">
              <Input
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="/path/to/documents"
                className="flex-1 text-sm font-mono"
              />
              <Button variant="outline" className="shrink-0">Browse</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              For local deployments. Enter the full path to a directory containing your documents.
            </p>
          </div>
        ) : (
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
              {isDragActive ? "Drop files here…" : "Drop files here or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Accepts files based on selected types below
            </p>
          </div>
        )}

        {/* Uploaded file list */}
        {inputMethod === "upload" && files.length > 0 && (
          <div className="space-y-1.5">
            {files.map((entry, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-muted/20 text-sm"
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate text-xs">{entry.name}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {(entry.file.size / 1024).toFixed(0)} KB
                </span>
                {entry.status === "pending" && <Badge variant="outline" className="text-[9px] shrink-0">Pending</Badge>}
                {entry.status === "processing" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
                {entry.status === "done" && (
                  <span className="flex items-center gap-1 text-[10px] text-green-600 shrink-0">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {entry.records?.length ?? 0} records
                  </span>
                )}
                {entry.status === "error" && (
                  <span className="flex items-center gap-1 text-[10px] text-red-500 shrink-0" title={entry.error}>
                    <AlertCircle className="h-3.5 w-3.5" /> Error
                  </span>
                )}
                {entry.status === "pending" && (
                  <button onClick={() => removeFile(idx)} className="text-muted-foreground hover:text-destructive shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* File types */}
        <div className="space-y-3">
          <div className="text-sm font-semibold">File Types:</div>
          <div className="flex flex-wrap gap-6">
            {FILE_TYPE_CONFIG.map((ft) => (
              <label key={ft.key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabledTypes.has(ft.key)}
                  onChange={() => toggleType(ft.key)}
                  className="accent-primary w-4 h-4"
                />
                <span className="text-sm font-medium">{ft.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t" />

      {/* ── Section 2: Processing Template ───────────────────────────────── */}
      <div className="space-y-5 py-8">
        <h2 className="text-2xl font-bold">2. Processing Template</h2>

        {/* Template selector */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm">Template</Label>
            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <Select value={templateKey} onValueChange={applyTemplate}>
            <SelectTrigger className="w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TEMPLATES).map(([key, t]) => (
                <SelectItem key={key} value={key} className="text-sm">{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{currentTemplate.desc}</p>
        </div>

        {/* Processing Instructions */}
        <div className="space-y-2">
          <Label className="text-sm">Processing Instructions</Label>
          <Textarea
            placeholder="Enter instructions for processing each document..."
            className="min-h-[160px] text-sm resize-y"
            value={processingInstructions}
            onChange={(e) => setProcessingInstructions(e.target.value)}
          />
        </div>

        {/* Output Columns */}
        <div className="space-y-3">
          <div className="text-sm font-bold">Output Columns:</div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label className="text-sm">Column Headers (comma-separated)</Label>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <Input
              value={outputColumns}
              onChange={(e) => setOutputColumns(e.target.value)}
              placeholder="column1,column2,column3"
              className="text-sm font-mono"
            />
          </div>

          {/* Output preview */}
          <div className="px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-sm">
            <span className="font-semibold text-blue-700 dark:text-blue-300">Output:</span>{" "}
            <span className="text-blue-600 dark:text-blue-400 font-mono text-xs">{outputPreview}</span>
          </div>
        </div>

        {/* Import/Export Templates collapsible */}
        <Collapsible open={showTemplateIO} onOpenChange={setShowTemplateIO}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full px-4 py-2.5 border rounded-lg hover:bg-muted/30 transition-colors text-sm">
            {showTemplateIO ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Import/Export Templates
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 border rounded-lg p-4 space-y-4 bg-muted/5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Export current template</Label>
                  <Button size="sm" variant="outline" onClick={exportTemplate}>Export</Button>
                </div>
                {exportedTemplate && (
                  <pre className="text-xs font-mono bg-muted/30 p-3 rounded border overflow-x-auto">{exportedTemplate}</pre>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Import template (paste JSON)</Label>
                <Textarea
                  placeholder='{"processingInstructions": "...", "outputColumns": "..."}'
                  className="min-h-[80px] text-xs font-mono resize-y"
                  onBlur={(e) => { if (e.target.value.trim()) importTemplate(e.target.value); }}
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Info / status box */}
        {!canProcess ? (
          <div className="px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
            Select a folder path or upload files to get started.
          </div>
        ) : !activeModel ? (
          <Link href="/settings">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 cursor-pointer hover:opacity-90 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No AI model configured — click here to add an API key in Settings
            </div>
          </Link>
        ) : null}
      </div>

      <div className="border-t" />

      {/* ── 3. Execute ───────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Execute</h2>
        <div className="grid grid-cols-2 gap-4">
          <Button
            size="lg"
            className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
            disabled={!canProcess || isProcessing || !activeModel}
            onClick={() => {
              // Test: process first file only
              const saved = files.slice(1);
              setFiles((prev) => prev.slice(0, 1));
              processAll().finally(() => setFiles((prev) => [...prev, ...saved]));
            }}
          >
            {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Test (1 file)
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-12 text-base"
            disabled={!canProcess || isProcessing || !activeModel}
            onClick={processAll}
          >
            {isProcessing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</>
            ) : (
              <><FileText className="h-4 w-4 mr-2" /> Process All ({files.length} file{files.length !== 1 ? "s" : ""})</>
            )}
          </Button>
        </div>
      </div>

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {allResults.length > 0 && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Extracted Data</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {allResults.length} records from {files.filter((f) => f.status === "done").length} file(s)
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
            </Button>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <DataTable data={allResults} />
          </div>
        </div>
      )}
    </div>
  );
}
