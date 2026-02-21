"use client";

import React, { useState } from "react";
import { FileUploader } from "@/components/tools/FileUploader";
import { DataTable } from "@/components/tools/DataTable";
import { SampleDatasetPicker } from "@/components/tools/SampleDatasetPicker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { useAppStore } from "@/lib/store";
import { Download, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import pLimit from "p-limit";
import Link from "next/link";

type Row = Record<string, unknown>;

function providerLabel(id: string) {
  if (id === "lmstudio") return "LM Studio";
  if (id === "ollama") return "Ollama";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export default function ModelComparisonPage() {
  const [data, setData] = useState<Row[]>([]);
  const [dataName, setDataName] = useState("");
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState(
    "Analyze the following data and provide a concise, structured response."
  );
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTestRun, setIsTestRun] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [results, setResults] = useState<Row[]>([]);

  const providers = useAppStore((state) => state.providers);
  const allProviders = Object.values(providers);
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];

  const handleDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    setSelectedCols(Object.keys(newData[0] || {}));
    setResults([]);
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const loadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (s) handleDataLoaded(s.data as Row[], s.name);
  };

  const toggleProvider = (id: string) =>
    setSelectedProviders((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);

  const toggleCol = (col: string) =>
    setSelectedCols((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]);

  const toggleAllCols = () =>
    setSelectedCols(selectedCols.length === allColumns.length ? [] : [...allColumns]);

  const startComparison = async (testMode: boolean) => {
    if (data.length === 0) return toast.error("No data loaded");
    if (selectedProviders.length < 2) return toast.error("Select at least 2 models to compare");
    if (!systemPrompt.trim()) return toast.error("Enter AI instructions first");

    const activeModels = selectedProviders
      .map((id) => ({ id, provider: id, model: providers[id]?.defaultModel ?? "", apiKey: providers[id]?.apiKey ?? "", baseUrl: providers[id]?.baseUrl }))
      .filter((m) => m.apiKey || providers[m.id]?.isLocal);

    if (activeModels.length < 2) return toast.error("Some selected providers have missing API keys");

    const targetData = testMode ? data.slice(0, 10) : data;
    setIsProcessing(true);
    setIsTestRun(testMode);
    setProgress({ completed: 0, total: targetData.length });
    const limit = pLimit(3);
    const newResults: Row[] = [...targetData];

    const tasks = targetData.map((row, idx) =>
      limit(async () => {
        try {
          const subset: Row = {};
          selectedCols.forEach((col) => (subset[col] = row[col]));
          const res = await fetch("/api/comparison-row", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ models: activeModels, systemPrompt, userContent: JSON.stringify(subset) }),
          });
          const result = await res.json();
          if (result.error) throw new Error(result.error);
          const updates: Row = {};
          (result.results as { id: string; output: string }[]).forEach((r) => { updates[`${r.id}_output`] = r.output; });
          newResults[idx] = { ...row, ...updates };
        } catch (err) { console.error(err); }
        setProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      })
    );

    await Promise.all(tasks);
    setResults(newResults);
    setIsProcessing(false);
    toast.success("Comparison complete!");
  };

  const handleExport = () => {
    if (!results.length) return;
    const headers = Object.keys(results[0]);
    const csv = [headers.join(","), ...results.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `comparison_results_${dataName || Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1">
        <h1 className="text-4xl font-bold">Model Comparison</h1>
        <p className="text-muted-foreground text-sm">Compare outputs from multiple LLMs side-by-side on your dataset</p>
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
        <p className="text-sm text-muted-foreground">Choose which columns to send to each model for each row.</p>

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
              <button onClick={toggleAllCols} className="underline hover:text-foreground transition-colors">
                {selectedCols.length === allColumns.length ? "Deselect all" : "Select all"}
              </button>
              <span>{selectedCols.length} of {allColumns.length} columns selected</span>
            </div>
          </>
        )}
      </div>

      <div className="border-t" />

      {/* ── 3. Select Models ──────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Select Models</h2>
        <p className="text-sm text-muted-foreground">Choose 2 or more models to compare. Only providers with API keys configured are selectable.</p>

        {allProviders.length === 0 ? (
          <Link href="/settings">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 cursor-pointer hover:opacity-90 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No providers configured — click here to go to Settings
            </div>
          </Link>
        ) : (
          <>
            <div className="space-y-2">
              {allProviders.map((p) => {
                const isSelected = selectedProviders.includes(p.providerId);
                const hasKey = p.isLocal || !!p.apiKey;
                return (
                  <label key={p.providerId} className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                    isSelected ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20"
                      : hasKey ? "border-border hover:border-muted-foreground/40"
                      : "opacity-40 cursor-not-allowed"
                  }`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!hasKey}
                      onChange={() => hasKey && toggleProvider(p.providerId)}
                      className="accent-primary w-4 h-4"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{providerLabel(p.providerId)}</div>
                      <div className="text-xs text-muted-foreground">{p.defaultModel}</div>
                    </div>
                    {!hasKey && <span className="text-xs text-muted-foreground">No API key</span>}
                  </label>
                );
              })}
            </div>
            {selectedProviders.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedProviders.length} model{selectedProviders.length > 1 ? "s" : ""} selected
                {selectedProviders.length < 2 && " — select at least 2 to compare"}
              </p>
            )}
          </>
        )}
      </div>

      <div className="border-t" />

      {/* ── 4. Define Instructions ────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">4. Define Instructions</h2>

        <div className="space-y-2">
          <span className="text-sm text-muted-foreground">System Prompt</span>
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="min-h-[140px] font-mono text-sm resize-y"
          />
          <p className="text-[11px] text-muted-foreground">
            The same prompt is sent to every selected model. Results are shown side-by-side.
          </p>
        </div>
      </div>

      <div className="border-t" />

      {/* ── 5. Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">5. Execute</h2>

        {isProcessing && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Comparing {selectedProviders.length} models across {progress.total} rows…
              </span>
              <span>{progress.completed} / {progress.total}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Button size="lg" className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
            disabled={data.length === 0 || isProcessing || selectedProviders.length < 2 || !systemPrompt.trim() || selectedCols.length === 0}
            onClick={() => startComparison(true)}>
            {isProcessing && isTestRun ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Test (10 rows)
          </Button>
          <Button variant="outline" size="lg" className="h-12 text-base"
            disabled={data.length === 0 || isProcessing || selectedProviders.length < 2 || !systemPrompt.trim() || selectedCols.length === 0}
            onClick={() => startComparison(false)}>
            {isProcessing && !isTestRun ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
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
              <p className="text-xs text-muted-foreground mt-0.5">{results.length} rows × {selectedProviders.length} models</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <DataTable data={results} />
          </div>
        </div>
      )}
    </div>
  );
}
