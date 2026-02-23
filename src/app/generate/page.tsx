"use client";

import React, { useState } from "react";
import { DataTable } from "@/components/tools/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveModel } from "@/lib/hooks";
import { AlertCircle, Sparkles, Plus, Trash2, Download, Loader2, Minus, ExternalLink } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type { GenerateColumn, Row } from "@/types";
import { generateRowDirect } from "@/lib/llm-browser";
import { createRun } from "@/lib/db-tauri";

// ─── Sample prompts ──────────────────────────────────────────────────────────
const SAMPLE_PROMPTS: Record<string, string> = {
  "Customer reviews": "Generate realistic customer product reviews including reviewer name, rating (1-5), review title, review body, product category, and whether the review was verified purchase.",
  "Job postings": "Generate realistic job postings with company name, job title, location, salary range, required experience (years), required skills, and job description.",
  "Survey responses": "Generate realistic employee engagement survey responses with respondent ID, department, tenure (years), satisfaction score (1-10), and open-ended feedback about workplace culture.",
  "Support tickets": "Generate realistic customer support tickets with ticket ID, customer name, issue category, priority (Low/Medium/High/Critical), issue description, and current status.",
  "Research interviews": "Generate realistic qualitative research interview excerpts with participant ID, age group, occupation, interview question, and participant response.",
  "Student feedback": "Generate student feedback on online courses with student ID, course name, completion status, rating (1-5), what they liked, and what could be improved.",
};

const COLUMN_TYPES = ["text", "number", "boolean", "list"] as const;

type OutputFormat = "tabular" | "json" | "freetext";
type Structure = "ai_decide" | "define_columns" | "use_template";
type RunMode = "preview" | "test" | "full";

const VARIATION_LEVELS = [
  { label: "Low", value: 0.3 },
  { label: "Medium", value: 0.6 },
  { label: "High", value: 0.9 },
  { label: "Maximum", value: 1.0 },
];

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function GeneratePage() {
  const activeModel = useActiveModel();

  const [description, setDescription] = useState("");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("tabular");
  const [structure, setStructure] = useState<Structure>("ai_decide");
  const [rowCount, setRowCount] = useState(100);
  const [variationIdx, setVariationIdx] = useState(1); // Medium
  const [columns, setColumns] = useState<GenerateColumn[]>([
    { name: "id", type: "number", description: "Unique identifier" },
    { name: "text", type: "text", description: "Main text field" },
    { name: "label", type: "text", description: "Category label" },
  ]);
  const [templateText, setTemplateText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("full");
  const [generatedData, setGeneratedData] = useState<Row[]>([]);
  const [generatedRaw, setGeneratedRaw] = useState("");
  const [runId, setRunId] = useState<string | null>(null);

  const temperature = VARIATION_LEVELS[variationIdx].value;

  const addColumn = () => setColumns((prev) => [...prev, { name: "", type: "text" }]);
  const removeColumn = (idx: number) => setColumns((prev) => prev.filter((_, i) => i !== idx));
  const updateColumn = (idx: number, updates: Partial<GenerateColumn>) =>
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, ...updates } : c)));

  const canGenerate = description.trim().length > 0 || structure === "define_columns";

  const generate = async (mode: RunMode) => {
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");
    if (!description.trim() && structure !== "define_columns") return toast.error("Describe the data you want to generate first.");
    if (structure === "define_columns" && columns.some((c) => !c.name.trim())) return toast.error("All column names must be filled in.");

    const count = mode === "preview" ? 3 : mode === "test" ? 10 : rowCount;

    setRunId(null);
    setIsGenerating(true);
    setRunMode(mode);
    setGeneratedData([]);
    setGeneratedRaw("");

    let localRunId: string | null = null;
    try {
      if (isTauri) {
        const rd = await createRun({
          runType: "generate",
          provider: activeModel.providerId,
          model: activeModel.defaultModel,
          temperature,
          inputFile: "synthetic",
          inputRows: count,
        });
        localRunId = rd.id ?? null;
      } else {
        const runRes = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runType: "generate",
            provider: activeModel.providerId,
            model: activeModel.defaultModel,
            temperature,
            inputFile: "synthetic",
            inputRows: count,
          }),
        });
        const rd = await runRes.json();
        localRunId = rd.id ?? null;
      }
    } catch { /* non-fatal */ }

    try {
      let data: { rows: Row[]; rawCsv?: string; count?: number; raw?: string; error?: string };
      if (isTauri) {
        data = await generateRowDirect({
          provider: activeModel.providerId,
          model: activeModel.defaultModel,
          apiKey: activeModel.apiKey || "",
          baseUrl: activeModel.baseUrl,
          rowCount: count,
          columns: structure === "define_columns" ? columns : undefined,
          freeformPrompt: description || undefined,
          temperature,
        });
      } else {
        const res = await fetch("/api/generate-row", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: activeModel.providerId,
            model: activeModel.defaultModel,
            apiKey: activeModel.apiKey || "local",
            baseUrl: activeModel.baseUrl,
            rowCount: count,
            columns: structure === "define_columns" ? columns : undefined,
            freeformPrompt: description || undefined,
            outputFormat,
            temperature,
          }),
        });
        data = await res.json();
      }
      if (data.error) throw new Error(data.error);

      if (outputFormat === "tabular") {
        setGeneratedData(data.rows as Row[]);
      } else {
        setGeneratedRaw(typeof data.raw === "string" ? data.raw : JSON.stringify(data.rows, null, 2));
      }
      setRunId(localRunId);
      toast.success(`Generated ${data.count ?? count} rows`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Generation failed", { description: msg });
    } finally {
      setIsGenerating(false);
    }
  };

  const exportCsv = () => {
    if (generatedData.length === 0) return;
    const headers = Object.keys(generatedData[0]);
    const csv = [
      headers.join(","),
      ...generatedData.map((row) =>
        headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `generated_data_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-0 pb-16">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="space-y-1 pb-6">
        <h1 className="text-4xl font-bold">Generate Data</h1>
        <p className="text-muted-foreground text-sm">
          Create synthetic datasets with AI-powered generation. Describe what you need and let AI build it for you.
        </p>
      </div>

      {/* ── 1. Describe Your Data ───────────────────────────────────────── */}
      <div className="space-y-3 pb-8">
        <h2 className="text-2xl font-bold">1. Describe Your Data</h2>
        <div className="flex gap-3 items-start">
          <Textarea
            placeholder="Example: Generate realistic customer profiles including full names, email addresses, and purchase history..."
            className="flex-1 min-h-[100px] text-sm resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="shrink-0">
            <Select
              onValueChange={(key) => {
                if (SAMPLE_PROMPTS[key]) {
                  setDescription(SAMPLE_PROMPTS[key]);
                }
              }}
            >
              <SelectTrigger className="w-[200px] h-9 text-xs">
                <SelectValue placeholder="-- Select a sample..." />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(SAMPLE_PROMPTS).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">{key}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="border-t" />

      {/* ── 2. Configure Output ─────────────────────────────────────────── */}
      <div className="space-y-0 py-8">
      <h2 className="text-2xl font-bold mb-5">2. Configure Output</h2>
      <div className="grid grid-cols-2 gap-8">
        {/* Output Format */}
        <div className="space-y-3">
          <div className="font-semibold text-sm">Output Format</div>
          <div className="space-y-2">
            {([
              { value: "tabular", label: "Tabular (CSV)", desc: "Structured rows and columns - best for spreadsheets and data analysis" },
              { value: "json", label: "JSON", desc: "Nested structured data - best for APIs and complex relationships" },
              { value: "freetext", label: "Free Text", desc: "Unstructured text output - best for qualitative data" },
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

        {/* Structure */}
        <div className="space-y-3">
          <div className="font-semibold text-sm">Structure</div>
          <div className="space-y-2">
            {([
              { value: "ai_decide", label: "Let AI decide", desc: "AI determines the best schema based on your description" },
              { value: "define_columns", label: "Define columns", desc: "Manually specify column names and types" },
              { value: "use_template", label: "Use Template", desc: "Provide a row template for the AI to follow" },
            ] as const).map(({ value, label, desc }) => (
              <label key={value} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="structure"
                  value={value}
                  checked={structure === value}
                  onChange={() => setStructure(value)}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <div className="text-sm font-medium leading-snug">{label}</div>
                  {structure === value && (
                    <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      </div>{/* end Configure Output section */}

      {/* Define columns builder (shown when structure === define_columns) */}
      {structure === "define_columns" && (
        <div className="pb-4 space-y-3">
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">Column Schema</div>
            <div className="p-3 space-y-2">
              {columns.map((col, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Input
                    placeholder="column_name"
                    value={col.name}
                    onChange={(e) => updateColumn(idx, { name: e.target.value })}
                    className="flex-1 h-8 text-xs"
                  />
                  <Select
                    value={col.type}
                    onValueChange={(v) => updateColumn(idx, { type: v as GenerateColumn["type"] })}
                  >
                    <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COLUMN_TYPES.map((t) => (
                        <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Description (optional)"
                    value={col.description || ""}
                    onChange={(e) => updateColumn(idx, { description: e.target.value })}
                    className="flex-1 h-8 text-xs text-muted-foreground"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => removeColumn(idx)}
                    disabled={columns.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="px-3 pb-3">
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={addColumn}>
                <Plus className="h-3 w-3 mr-2" /> Add Column
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Use Template textarea */}
      {structure === "use_template" && (
        <div className="pb-6 space-y-2">
          <Label className="text-sm font-medium">Row Template</Label>
          <Textarea
            placeholder={`Provide an example row for the AI to follow:\n\n{"name": "John Smith", "age": 34, "feedback": "Great product!", "rating": 5}`}
            className="min-h-[120px] text-xs font-mono resize-y"
            value={templateText}
            onChange={(e) => setTemplateText(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">The AI will generate rows that follow this structure and style.</p>
        </div>
      )}

      <div className="border-t" />

      {/* ── 3. Generation Settings ──────────────────────────────────────── */}
      <div className="py-8 space-y-5">
        <h2 className="text-2xl font-bold">3. Generation Settings</h2>

        <div className="grid grid-cols-2 gap-8">
          {/* Row count */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Rows to Generate</Label>
            <div className="flex items-center border rounded-lg overflow-hidden">
              <button
                className="px-4 py-2.5 hover:bg-muted text-sm border-r transition-colors"
                onClick={() => setRowCount((n) => Math.max(1, n - 10))}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <Input
                type="number"
                min={1}
                max={500}
                value={rowCount}
                onChange={(e) => setRowCount(Math.min(500, Math.max(1, parseInt(e.target.value) || 1)))}
                className="flex-1 border-none h-10 text-center text-sm focus-visible:ring-0 rounded-none"
              />
              <button
                className="px-4 py-2.5 hover:bg-muted text-sm border-l transition-colors"
                onClick={() => setRowCount((n) => Math.min(500, n + 10))}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Variation level */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-muted-foreground">Variation Level</Label>
              <span className="text-sm font-semibold text-primary">{VARIATION_LEVELS[variationIdx].label}</span>
            </div>
            <input
              type="range"
              min={0}
              max={VARIATION_LEVELS.length - 1}
              step={1}
              value={variationIdx}
              onChange={(e) => setVariationIdx(parseInt(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Low</span>
              <span>Maximum</span>
            </div>
          </div>
        </div>

        {/* Info / warning box */}
        {!canGenerate ? (
          <div className="px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
            Describe the data you want to generate to get started.
          </div>
        ) : !activeModel ? (
          <Link href="/settings">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 cursor-pointer hover:opacity-90 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No AI model configured — click here to add an API key in Settings
            </div>
          </Link>
        ) : (
          <div className="px-4 py-3 rounded-lg bg-muted/30 border text-xs text-muted-foreground">
            Ready to generate {rowCount} rows using <strong>{activeModel.providerId} / {activeModel.defaultModel}</strong>
            {" "} · Variation: <strong>{VARIATION_LEVELS[variationIdx].label}</strong> (temp {temperature})
          </div>
        )}
      </div>

      <div className="border-t" />

      {/* ── 4. Execute ──────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">4. Execute</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button
            variant="outline"
            size="lg"
            className="h-12 text-sm border-dashed"
            disabled={!canGenerate || isGenerating || !activeModel}
            onClick={() => generate("preview")}
          >
            {isGenerating && runMode === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Preview (3 rows)
          </Button>
          <Button
            size="lg"
            className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
            disabled={!canGenerate || isGenerating || !activeModel}
            onClick={() => generate("test")}
          >
            {isGenerating && runMode === "test" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Test (10 rows)
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-12 text-base"
            disabled={!canGenerate || isGenerating || !activeModel}
            onClick={() => generate("full")}
          >
            {isGenerating && runMode === "full" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {isGenerating && runMode === "full" ? `Generating…` : `Generate All (${rowCount} rows)`}
          </Button>
        </div>
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
              {generatedData.length > 0 && (
                <Button variant="outline" size="sm" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
                </Button>
              )}
              {generatedRaw && outputFormat !== "tabular" && (
                <Button variant="outline" size="sm" onClick={() => {
                  const ext = outputFormat === "json" ? "json" : "txt";
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

          {generatedData.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <DataTable data={generatedData} />
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/20 text-xs font-medium text-muted-foreground">Raw output</div>
              <pre className="p-4 text-xs font-mono whitespace-pre-wrap max-h-[500px] overflow-y-auto">{generatedRaw}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
