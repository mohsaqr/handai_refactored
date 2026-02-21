"use client";

import React, { useState } from "react";
import { FileUploader } from "@/components/tools/FileUploader";
import { DataTable } from "@/components/tools/DataTable";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveModel } from "@/lib/hooks";
import { Download, Loader2, AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import pLimit from "p-limit";
import Link from "next/link";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { SampleDatasetPicker } from "@/components/tools/SampleDatasetPicker";

type Row = Record<string, unknown>;
type RunMode = "preview" | "test" | "full";

const EXAMPLE_PROMPTS: Record<string, string> = {
  "Sentiment analysis": "Classify the sentiment as Positive, Negative, or Neutral. Return only the label.",
  "Topic extraction": "Extract the main topic in 3 words or less. Return only the topic.",
  "One-sentence summary": "Summarize in one sentence. Return only the summary.",
  "Issue detection": "Identify any product issues mentioned. If none, return 'None'.",
  "Urgency rating": "Rate the urgency as Low, Medium, or High based on the text. Return only the label.",
  "Keyword extraction": "Extract the 3 most important keywords. Return as comma-separated values.",
  "Language detection": "Detect the language of the text. Return the language name only.",
};

export default function TransformPage() {
  const [data, setData] = useState<Row[]>([]);
  const [dataName, setDataName] = useState("");
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("full");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [results, setResults] = useState<Row[]>([]);
  const [stats, setStats] = useState<{ success: number; errors: number; avgLatency: number } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState(5);

  const activeModel = useActiveModel();
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];

  const handleDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    setSelectedCols(Object.keys(newData[0] || {}));
    setResults([]);
    setStats(null);
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const loadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (s) handleDataLoaded(s.data as Row[], s.name);
  };

  const toggleCol = (col: string) =>
    setSelectedCols((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );

  const toggleAll = () =>
    setSelectedCols(selectedCols.length === allColumns.length ? [] : [...allColumns]);

  const runTransformation = async (mode: RunMode) => {
    if (data.length === 0) return toast.error("No data loaded");
    if (!systemPrompt.trim()) return toast.error("Enter AI instructions first");
    if (!activeModel) return toast.error("No model configured. Go to Settings.");
    if (selectedCols.length === 0) return toast.error("Select at least one column");

    const targetData =
      mode === "preview" ? data.slice(0, 3) :
      mode === "test"    ? data.slice(0, 10) :
      data;

    setRunId(null);
    setIsProcessing(true);
    setRunMode(mode);
    setProgress({ completed: 0, total: targetData.length });
    setResults([]);
    setStats(null);

    const limit = pLimit(concurrency);
    const newResults: Row[] = [...targetData];
    const latencies: number[] = [];

    let localRunId: string | null = null;
    try {
      const runRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runType: "transform",
          provider: activeModel.providerId,
          model: activeModel.defaultModel,
          temperature: 0,
          systemPrompt,
          inputFile: dataName || "unnamed",
          inputRows: targetData.length,
        }),
      });
      const rd = await runRes.json();
      localRunId = rd.id ?? null;
    } catch { /* non-fatal */ }

    const tasks = targetData.map((row, idx) =>
      limit(async () => {
        const t0 = Date.now();
        try {
          const subset: Row = {};
          selectedCols.forEach((col) => (subset[col] = row[col]));
          const res = await fetch("/api/process-row", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: activeModel.providerId,
              model: activeModel.defaultModel,
              apiKey: activeModel.apiKey || "local",
              baseUrl: activeModel.baseUrl,
              systemPrompt,
              userContent: Object.entries(subset).map(([k, v]) => `${k}: ${String(v ?? "")}`).join("\n"),
              temperature: 0,
            }),
          });
          const result = await res.json();
          if (result.error) throw new Error(result.error);
          const latency = Date.now() - t0;
          latencies.push(latency);
          newResults[idx] = { ...row, ai_output: result.output, status: "success", latency_ms: latency };
        } catch (err) {
          newResults[idx] = { ...row, ai_output: "ERROR", status: "error", error_msg: String(err) };
        }
        setProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      })
    );

    await Promise.all(tasks);

    const errors = newResults.filter((r) => r.status === "error").length;
    const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    setResults(newResults);
    setStats({ success: newResults.length - errors, errors, avgLatency });

    if (localRunId) {
      try {
        await fetch("/api/results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: localRunId,
            results: newResults.map((r, i) => ({
              rowIndex: i, input: r, output: r.ai_output,
              status: r.status, latency: r.latency_ms, errorMessage: r.error_msg,
            })),
          }),
        });
      } catch { /* non-fatal */ }
    }

    setRunId(localRunId);
    setIsProcessing(false);
    if (errors > 0) toast.warning(`Done — ${errors} rows had errors`);
    else toast.success(mode === "full" ? "Transformation complete!" : `${mode === "preview" ? "Preview" : "Test"} complete (${targetData.length} rows)`);
  };

  const handleExport = () => {
    if (!results.length) return;
    const headers = Object.keys(results[0]);
    const csv = [headers.join(","), ...results.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `transformed_${dataName || "data"}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1">
        <h1 className="text-4xl font-bold">Transform Data</h1>
        <p className="text-muted-foreground text-sm">Apply AI transformations to each row of your dataset</p>
      </div>

      {/* ── 1. Upload Data ────────────────────────────────────────────────── */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Upload Data</h2>
        <FileUploader onDataLoaded={handleDataLoaded} />
        <SampleDatasetPicker onSelect={loadSample} />

        {data.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 text-sm text-green-700 dark:text-green-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span><strong>{data.length} rows</strong> loaded from <strong>{dataName}</strong></span>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium flex justify-between">
                <span>Data Preview</span>
                <span className="text-xs text-muted-foreground font-normal">first 5 of {data.length} rows</span>
              </div>
              <DataTable data={data} maxRows={5} />
            </div>
          </>
        )}
      </div>

      <div className="border-t" />

      {/* ── 2. Select Columns ─────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Select Columns</h2>
        <p className="text-sm text-muted-foreground">Choose which columns to send to the AI for each row.</p>

        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Upload data first to see available columns.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-4 border rounded-lg bg-muted/5">
              {allColumns.map((col) => (
                <label key={col} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedCols.includes(col)}
                    onChange={() => toggleCol(col)}
                    className="accent-primary w-4 h-4"
                  />
                  <span className="text-sm truncate group-hover:text-foreground transition-colors">{col}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <button onClick={toggleAll} className="underline hover:text-foreground transition-colors">
                {selectedCols.length === allColumns.length ? "Deselect all" : "Select all"}
              </button>
              <span>{selectedCols.length} of {allColumns.length} columns selected</span>
            </div>
          </>
        )}
      </div>

      <div className="border-t" />

      {/* ── 3. Processing Instructions ────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Processing Instructions</h2>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Instructions</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Example:</span>
              <Select onValueChange={(v) => { if (v) setSystemPrompt(EXAMPLE_PROMPTS[v] || ""); }}>
                <SelectTrigger className="h-7 text-xs w-[200px]">
                  <SelectValue placeholder="Load an example…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(EXAMPLE_PROMPTS).map((k) => (
                    <SelectItem key={k} value={k} className="text-xs">{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Textarea
            placeholder="Example: Classify the sentiment of the text as Positive, Negative, or Neutral. Return only the label."
            className="min-h-[180px] font-mono text-sm leading-relaxed resize-y"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            The AI processes each row individually using these instructions. Only selected columns are included as context.
          </p>
        </div>

        {!activeModel && (
          <Link href="/settings">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 cursor-pointer hover:opacity-90 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No AI model configured — click here to add an API key in Settings
            </div>
          </Link>
        )}
      </div>

      <div className="border-t" />

      {/* ── 4. Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">4. Execute</h2>

        {isProcessing && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {runMode !== "full" ? (runMode === "preview" ? "Preview" : "Test") + " run" : "Full run"} — processing {progress.total} rows…
              </span>
              <span>{progress.completed} / {progress.total}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Concurrency:</span>
          <button className="px-2 py-1 border rounded hover:bg-muted transition-colors" onClick={() => setConcurrency(c => Math.max(1, c - 1))}>−</button>
          <span className="px-3 border-x min-w-[2rem] text-center">{concurrency}</span>
          <button className="px-2 py-1 border rounded hover:bg-muted transition-colors" onClick={() => setConcurrency(c => Math.min(10, c + 1))}>+</button>
          <span className="text-xs">(parallel API calls)</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Button variant="outline" size="lg" className="h-12 text-sm border-dashed"
            disabled={data.length === 0 || isProcessing || !activeModel || !systemPrompt.trim() || selectedCols.length === 0}
            onClick={() => runTransformation("preview")}>
            {isProcessing && runMode === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Preview (3 rows)
          </Button>
          <Button size="lg" className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
            disabled={data.length === 0 || isProcessing || !activeModel || !systemPrompt.trim() || selectedCols.length === 0}
            onClick={() => runTransformation("test")}>
            {isProcessing && runMode === "test" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Test (10 rows)
          </Button>
          <Button variant="outline" size="lg" className="h-12 text-base"
            disabled={data.length === 0 || isProcessing || !activeModel || !systemPrompt.trim() || selectedCols.length === 0}
            onClick={() => runTransformation("full")}>
            {isProcessing && runMode === "full" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Full Run ({data.length} rows)
          </Button>
        </div>
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Results</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{results.length} rows transformed</p>
            </div>
            <div className="flex items-center gap-3">
              {runId && (
                <Link href={`/history/${runId}`} className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  View in History
                </Link>
              )}
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" /> Export CSV
              </Button>
            </div>
          </div>

          {stats && (
            <div className={`flex items-center gap-6 px-5 py-3 rounded-lg border text-sm ${stats.errors > 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"}`}>
              <div className="flex items-center gap-2">
                {stats.errors > 0 ? <AlertCircle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-green-500" />}
                <span className="font-medium">{stats.errors > 0 ? `Completed with ${stats.errors} error${stats.errors > 1 ? "s" : ""}` : "All rows transformed successfully"}</span>
              </div>
              <span className="text-muted-foreground text-xs">✓ {stats.success}</span>
              {stats.errors > 0 && <span className="text-red-500 text-xs">✗ {stats.errors}</span>}
              <span className="text-muted-foreground text-xs">⏱ avg {stats.avgLatency}ms</span>
              {runMode !== "full" && <span className="ml-auto text-xs font-medium text-blue-600 border border-blue-200 px-2 py-0.5 rounded bg-blue-50">{runMode === "preview" ? "Preview" : "Test"} run · {results.length}/{data.length} rows</span>}
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">Transformed Data — {results.length} rows</div>
            <DataTable data={results} />
          </div>
        </div>
      )}
    </div>
  );
}
