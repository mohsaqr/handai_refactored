"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PromptEditor } from "@/components/tools/PromptEditor";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { useAppStore } from "@/lib/store";
import { useSystemSettings } from "@/lib/hooks";
import { useRestoreSession } from "@/hooks/useRestoreSession";
import { AlertCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import { useColumnSelection } from "@/hooks/useColumnSelection";
import { dispatchComparisonRow } from "@/lib/llm-dispatch";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useProcessingStore } from "@/lib/processing-store";

import { UploadPreview } from "@/components/tools/UploadPreview";
import { ColumnSelector } from "@/components/tools/ColumnSelector";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { ExecutionPanel } from "@/components/tools/ExecutionPanel";
import { ResultsPanel } from "@/components/tools/ResultsPanel";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";

type Row = Record<string, unknown>;

function providerLabel(id: string) {
  if (id === "lmstudio") return "LM Studio";
  if (id === "ollama") return "Ollama";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

const SAMPLE_PROMPTS: Record<string, string> = {
  "Analyze and summarize": "Analyze the following data and provide a concise summary of the key findings.",
  "Extract key themes": "Identify and list the main themes or topics present in this data.",
  "Classify sentiment": "Classify the sentiment of this text as positive, negative, or neutral. Return only the classification.",
  "Translate to French": "Translate the following text to French. Return only the translated text.",
};

export default function ModelComparisonPage() {
  const [data, setData] = useSessionState<Row[]>("modelcomp_data", []);
  const [dataName, setDataName] = useSessionState("modelcomp_dataName", "");
  const [systemPrompt, setSystemPrompt] = useSessionState(
    "modelcomp_systemPrompt",
    "Analyze the following data and provide a concise, structured response."
  );
  const [selectedProviders, setSelectedProviders] = useSessionState<string[]>("modelcomp_selectedProviders", []);

  const providers = useAppStore((state) => state.providers);
  const systemSettings = useSystemSettings();
  const [concurrency, setConcurrency] = useState(systemSettings.maxConcurrency);

  // Only show providers with API key or local
  const availableProviders = Object.values(providers).filter((p) => p.isLocal || !!p.apiKey);

  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const { selectedCols, setSelectedCols, toggleCol, toggleAll } = useColumnSelection("modelcomp_selectedCols", allColumns, false);

  // ── Auto-generate AI Instructions ──
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a data analysis assistant. Apply the described instruction to each row.");
    lines.push("");

    if (systemPrompt.trim()) {
      lines.push("INSTRUCTION:");
      lines.push(systemPrompt.trim());
      lines.push("");
    }

    if (selectedCols.length > 0) {
      lines.push("SELECTED COLUMNS:");
      selectedCols.forEach((c) => lines.push(`- ${c}`));
      lines.push("");
    }

    if (selectedProviders.length > 0) {
      lines.push("SELECTED MODELS:");
      selectedProviders.forEach((id) => {
        const p = providers[id];
        lines.push(`- ${providerLabel(id)}/${p?.defaultModel ?? "unknown"}`);
      });
      lines.push("");
    }

    lines.push("RULES:");
    lines.push("- Process each row independently");
    lines.push("- Return only the result, no explanation");
    lines.push("- Do not include markdown or code fences");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [systemPrompt, selectedCols, selectedProviders, providers]);

  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  // Use the first selected provider as a "representative" activeModel for the batch processor.
  // The actual multi-model dispatch happens inside processRow via dispatchComparisonRow.
  const representativeModel = useMemo(() => {
    if (selectedProviders.length === 0) return null;
    const firstId = selectedProviders[0];
    return providers[firstId] ?? null;
  }, [selectedProviders, providers]);

  // Reorder columns: original cols → all outputs → all latencies
  const reorderColumns = useCallback((rows: Row[]): Row[] => {
    if (rows.length === 0) return rows;
    const allKeys = Object.keys(rows[0]);
    const originalKeys = allKeys.filter((k) => !k.endsWith("_output") && !k.endsWith("_latency_ms") && k !== "error_msg" && k !== "status" && k !== "latency_ms");
    const outputKeys = allKeys.filter((k) => k.endsWith("_output"));
    const latencyKeys = allKeys.filter((k) => k.endsWith("_latency_ms") && k !== "latency_ms");
    const errorKeys = allKeys.filter((k) => k === "error_msg");
    const orderedKeys = [...originalKeys, ...outputKeys, ...latencyKeys, ...errorKeys];

    return rows.map((row) => {
      const ordered: Row = {};
      orderedKeys.forEach((k) => { if (k in row) ordered[k] = row[k]; });
      return ordered;
    });
  }, []);

  const batch = useBatchProcessor({
    toolId: "/model-comparison",
    runType: "model-comparison",
    activeModel: representativeModel,
    systemSettings,
    data,
    dataName,
    systemPrompt: aiInstructions,
    concurrency,
    validate: () => {
      if (selectedProviders.length < 2) return "Select at least 2 models to compare";
      if (!systemPrompt.trim()) return "Enter instructions first";
      if (selectedCols.length === 0) return "Select at least one column";
      // Verify all selected providers have valid credentials
      const activeModels = selectedProviders
        .map((id) => ({ id, provider: id, model: providers[id]?.defaultModel ?? "", apiKey: providers[id]?.apiKey ?? "", baseUrl: providers[id]?.baseUrl }))
        .filter((m) => m.apiKey || providers[m.id]?.isLocal);
      if (activeModels.length < 2) return "Some selected providers have missing API keys";
      return null;
    },
    runParams: {
      provider: selectedProviders.join(","),
      model: representativeModel?.defaultModel ?? "unknown",
      temperature: systemSettings.temperature,
    },
    processRow: async (row: Row) => {
      const activeModels = selectedProviders
        .map((id) => ({ id, provider: id, model: providers[id]?.defaultModel ?? "", apiKey: providers[id]?.apiKey ?? "", baseUrl: providers[id]?.baseUrl }))
        .filter((m) => m.apiKey || providers[m.id]?.isLocal);

      const subset: Row = {};
      selectedCols.forEach((col) => (subset[col] = row[col]));

      const result = await dispatchComparisonRow({
        models: activeModels,
        systemPrompt: aiInstructions,
        userContent: JSON.stringify(subset),
      });

      const outputUpdates: Row = {};
      const latencyUpdates: Row = {};
      (result.results as { id: string; output: string; latency?: number }[]).forEach((r) => {
        outputUpdates[`${r.id}_output`] = r.output;
        if (r.latency !== undefined) latencyUpdates[`${r.id}_latency_ms`] = String(Math.round(r.latency * 1000));
      });
      // Order: original row → outputs → latencies
      return { ...row, ...outputUpdates, ...latencyUpdates, status: "success" };
    },
    buildResultEntry: (r: Row, i: number) => ({
      rowIndex: i,
      input: r as Record<string, unknown>,
      output: JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k.endsWith("_output")))),
      status: (r.status as string) ?? (r.error_msg ? "error" : "success"),
      errorMessage: r.error_msg as string | undefined,
    }),
  });

  // Reordered results for display
  const displayResults = useMemo(() => reorderColumns(batch.results), [batch.results, reorderColumns]);

  // ── Session restore from history ───────────────────────────────────────────
  const restored = useRestoreSession("model-comparison");
  useEffect(() => {
    if (!restored) return;
    queueMicrotask(() => {
      setData(restored.data);
      setDataName(restored.dataName);

      const fullPrompt = restored.systemPrompt ?? "";

      // Restore instructions
      const instrMatch = fullPrompt.match(/INSTRUCTION:\n([\s\S]*?)(?:\n\n|$)/);
      setSystemPrompt(instrMatch ? instrMatch[1].trim() : fullPrompt);

      // Restore selected columns
      const colsMatch = fullPrompt.match(/SELECTED COLUMNS:\n([\s\S]*?)(?:\n\n|$)/);
      if (colsMatch) {
        const cols = colsMatch[1].split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean);
        if (cols.length > 0) setSelectedCols(cols);
      }

      // Restore selected providers from "SELECTED MODELS:" section
      const modelsMatch = fullPrompt.match(/SELECTED MODELS:\n([\s\S]*?)(?:\n\n|$)/);
      if (modelsMatch) {
        const providerIds = modelsMatch[1].split("\n")
          .map((l) => l.replace(/^- /, "").trim())
          .filter(Boolean)
          .map((entry) => {
            // Format is "ProviderLabel/model" — extract provider ID
            const slashIdx = entry.indexOf("/");
            const label = slashIdx >= 0 ? entry.slice(0, slashIdx) : entry;
            // Convert label back to provider ID
            const lower = label.toLowerCase().replace(/\s+/g, "");
            if (lower === "lmstudio") return "lmstudio";
            return lower;
          })
          .filter(Boolean);
        if (providerIds.length > 0) setSelectedProviders(providerIds);
      }

      // Populate results in global processing store
      const errors = restored.results.filter((r) => r.status === "error").length;
      useProcessingStore.getState().completeJob(
        "/model-comparison",
        restored.results,
        { success: restored.results.length - errors, errors, avgLatency: 0 },
        restored.runId,
      );
      toast.success(`Restored session from "${restored.dataName}" (${restored.data.length} rows)`);
    });
  }, [restored]);

  const handleDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    batch.clearResults();
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const handleLoadSample = (key: string) => {
    const ds = SAMPLE_DATASETS[key];
    if (ds) handleDataLoaded(ds.data as Row[], ds.name);
  };

  const toggleProvider = (id: string) =>
    setSelectedProviders((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);

  return (
    <div className="space-y-0 pb-16">
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">Model Comparison</h1>
          <p className="text-muted-foreground text-sm">Compare outputs from multiple LLMs side-by-side on your dataset</p>
        </div>
        {data.length > 0 && (
          <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("modelcomp_"); setData([]); setDataName(""); setSelectedProviders([]); setSystemPrompt("Analyze the following data and provide a concise, structured response."); setConcurrency(systemSettings.maxConcurrency); setAiInstructions(""); batch.clearResults(); }}>
            <RotateCcw className="h-3.5 w-3.5" /> Start Over
          </Button>
        )}
      </div>

      <div className={batch.isProcessing ? "pointer-events-none opacity-60" : ""}>
      {/* ── 1. Upload Data */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Upload Data</h2>
        <UploadPreview
          data={data}
          dataName={dataName}
          onDataLoaded={handleDataLoaded}
          samplePickerPosition="above"
          customSamplePicker={
            <Select onValueChange={handleLoadSample}>
              <SelectTrigger className="w-[200px] h-9 text-xs">
                <SelectValue placeholder="-- Select a sample..." />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(SAMPLE_DATASETS).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {SAMPLE_DATASETS[key].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </div>

      <div className="border-t" />

      {/* ── 2. Define Columns */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Define Columns</h2>
        <ColumnSelector
          allColumns={allColumns}
          selectedCols={selectedCols}
          onToggleCol={toggleCol}
          onToggleAll={toggleAll}
          description="Choose which columns to send to each model for each row."
        />
      </div>

      <div className="border-t" />

      {/* ── 3. Select Models */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Select Models</h2>
        <p className="text-sm text-muted-foreground">Choose 2 or more models to compare.</p>

        {availableProviders.length === 0 ? (
          <Link href="/settings">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 cursor-pointer hover:opacity-90 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No providers with API keys configured — click here to go to Settings
            </div>
          </Link>
        ) : (
          <>
            <div className="space-y-2">
              {availableProviders.map((p) => {
                const isSelected = selectedProviders.includes(p.providerId);
                return (
                  <label key={p.providerId} className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                    isSelected ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20"
                      : "border-border hover:border-muted-foreground/40"
                  }`}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleProvider(p.providerId)} className="accent-primary w-4 h-4" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{providerLabel(p.providerId)}</div>
                      <div className="text-xs text-muted-foreground">{p.defaultModel}</div>
                    </div>
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

      {/* ── 4. Define Instructions */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">4. Define Instructions</h2>
        <PromptEditor
          value={systemPrompt}
          onChange={setSystemPrompt}
          placeholder="Describe what each model should do with each row..."
          examplePrompts={SAMPLE_PROMPTS}
          label="Instructions"
          helpText="The same prompt is sent to every selected model. Results are shown side-by-side."
        />
      </div>

      <div className="border-t" />

      {/* ── 5. AI Instructions */}
      <AIInstructionsSection
        sectionNumber={5}
        value={aiInstructions}
        onChange={setAiInstructions}
      >
        <NoModelWarning activeModel={availableProviders.length > 0 ? availableProviders[0] : null} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2">
          <span>Concurrency:</span>
          <button className="px-2 py-1 border rounded hover:bg-muted transition-colors" onClick={() => setConcurrency(c => Math.max(1, c - 1))}>−</button>
          <span className="px-3 border-x min-w-[2rem] text-center">{concurrency}</span>
          <button className="px-2 py-1 border rounded hover:bg-muted transition-colors" onClick={() => setConcurrency(c => Math.min(10, c + 1))}>+</button>
          <span className="text-xs">(parallel API calls)</span>
        </div>
      </AIInstructionsSection>

      </div>

      <div className="border-t" />

      {/* ── 6. Execute */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">6. Execute</h2>
        <ExecutionPanel
          isProcessing={batch.isProcessing}
          aborting={batch.aborting}
          runMode={batch.runMode}
          progress={batch.progress}
          etaStr={batch.etaStr}
          dataCount={data.length}
          disabled={data.length === 0 || selectedProviders.length < 2 || !systemPrompt.trim() || selectedCols.length === 0}
          onRun={batch.run}
          onAbort={batch.abort}
          onResume={batch.resume}
          onCancel={batch.clearResults}
          failedCount={batch.failedCount}
          skippedCount={batch.skippedCount}
          fullLabel={`Full Run (${data.length} rows)`}
        />
      </div>

      {/* ── Results */}
      <ResultsPanel
        results={displayResults}
        runId={batch.runId}
        title="Results"
        subtitle={`${displayResults.length} rows × ${selectedProviders.length} models`}
      />
    </div>
  );
}
