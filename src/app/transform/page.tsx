"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { Plus, X, Upload, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { usePersistedPrompt } from "@/hooks/usePersistedPrompt";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useColumnSelection } from "@/hooks/useColumnSelection";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useRestoreSession } from "@/hooks/useRestoreSession";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { dispatchProcessRow } from "@/lib/llm-dispatch";
import { useProcessingStore } from "@/lib/processing-store";

import { UploadPreview } from "@/components/tools/UploadPreview";
import { ColumnSelector } from "@/components/tools/ColumnSelector";
import { PromptEditor } from "@/components/tools/PromptEditor";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { ExecutionPanel } from "@/components/tools/ExecutionPanel";
import { ResultsPanel } from "@/components/tools/ResultsPanel";

type Row = Record<string, unknown>;
type RunMode = "preview" | "test" | "full";
type OutputMode = "combined" | "separate";
type FilterOp = "contains" | "equals" | "starts" | "ends" | "gt" | "lt" | "gte" | "lte";
type FilterEntry = { col: string; op: FilterOp; val: string };
type ColType = "text" | "number" | "boolean";

const OPS_BY_TYPE: Record<ColType, { value: FilterOp; label: string }[]> = {
  text: [
    { value: "contains", label: "contains" },
    { value: "equals", label: "equals" },
    { value: "starts", label: "starts with" },
    { value: "ends", label: "ends with" },
  ],
  number: [
    { value: "equals", label: "=" },
    { value: "gt", label: ">" },
    { value: "lt", label: "<" },
    { value: "gte", label: ">=" },
    { value: "lte", label: "<=" },
  ],
  boolean: [
    { value: "equals", label: "equals" },
  ],
};

const EXAMPLE_PROMPTS: Record<string, string> = {
  "Translate to French": "Translate the text to French. Return only the translated text.",
  "Translate to English": "Translate the text to English. Return only the translated text.",
  "Convert currency to EUR": "Convert any monetary amounts to EUR. Return only the converted value.",
  "Standardize date format": "Convert the date to ISO 8601 format (YYYY-MM-DD). Return only the formatted date.",
  "Fix spelling & grammar": "Correct any spelling and grammar errors. Return only the corrected text.",
  "Anonymize PII": "Replace personal identifiable information (names, emails, phones) with placeholder tokens. Return the anonymized text.",
  "Normalize casing": "Convert the text to proper title case. Return only the normalized text.",
};

export default function TransformPage() {
  const uploadRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useSessionState<Row[]>("transform_data", []);
  const [dataName, setDataName] = useSessionState("transform_dataName", "");
  const [systemPrompt, setSystemPrompt] = usePersistedPrompt("handai_prompt_transform");

  // Row filter & select — multi-filter
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [filters, setFilters] = useSessionState<FilterEntry[]>("transform_filters", [{ col: "", op: "contains", val: "" }]);

  const activeModel = useActiveModel();
  const systemSettings = useSystemSettings();
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const { selectedCols, setSelectedCols, toggleCol, toggleAll } = useColumnSelection("transform_selectedCols", allColumns, false);
  const [outputMode, setOutputMode] = useSessionState<OutputMode>("transform_outputMode", "combined");

  // Auto-select all rows when data is restored from session
  useEffect(() => {
    if (data.length > 0 && selectedRows.size === 0) {
      setSelectedRows(new Set(data.map((_, i) => i)));
    }
  }, [data.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect column types by sampling data
  const colTypes = useMemo<Record<string, ColType>>(() => {
    if (data.length === 0) return {};
    const result: Record<string, ColType> = {};
    for (const col of Object.keys(data[0])) {
      const sample = data.slice(0, 50).map((r) => r[col]).filter((v) => v != null && v !== "");
      if (sample.length === 0) { result[col] = "text"; continue; }
      if (sample.every((v) => typeof v === "boolean" || v === "true" || v === "false")) {
        result[col] = "boolean";
      } else if (sample.every((v) => typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v))))) {
        result[col] = "number";
      } else {
        result[col] = "text";
      }
    }
    return result;
  }, [data]);

  // Resolve a unique column name, appending _1, _2, ... on collision
  const resolveColName = useCallback((base: string, existingCols: Set<string>) => {
    if (!existingCols.has(base)) return base;
    let n = 1;
    while (existingCols.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  }, []);

  // Combined mode: single output column named after all selected columns
  const outputCol = useMemo(() => {
    const suffix = selectedCols.length > 0
      ? selectedCols.slice().sort().join("-")
      : "";
    const base = suffix ? `ai_output_${suffix}` : "ai_output";
    if (data.length === 0) return base;
    return resolveColName(base, new Set(Object.keys(data[0])));
  }, [data, selectedCols, resolveColName]);

  // Separate mode: one output column per selected column
  const outputColMap = useMemo(() => {
    if (data.length === 0) {
      return Object.fromEntries(selectedCols.map((col) => [col, `ai_output_${col}`]));
    }
    const existing = new Set(Object.keys(data[0]));
    const map: Record<string, string> = {};
    for (const col of selectedCols.slice().sort()) {
      const name = resolveColName(`ai_output_${col}`, existing);
      map[col] = name;
      existing.add(name); // prevent collisions between separate columns
    }
    return map;
  }, [data, selectedCols, resolveColName]);

  // Multi-filter: AND logic, skip empty filters
  const filteredIndices = useMemo(() => {
    const activeFilters = filters.filter((f) => f.col && f.val);
    if (activeFilters.length === 0) return data.map((_, i) => i);
    return data.reduce<number[]>((acc, row, i) => {
      const allMatch = activeFilters.every((f) => {
        const raw = row[f.col];
        const val = String(raw ?? "").toLowerCase();
        const fv = f.val.toLowerCase();
        if (f.op === "contains") return val.includes(fv);
        if (f.op === "equals") return val === fv;
        if (f.op === "starts") return val.startsWith(fv);
        if (f.op === "ends") return val.endsWith(fv);
        const numA = Number(raw);
        const numB = Number(f.val);
        if (f.op === "gt") return numA > numB;
        if (f.op === "lt") return numA < numB;
        if (f.op === "gte") return numA >= numB;
        if (f.op === "lte") return numA <= numB;
        return true;
      });
      if (allMatch) acc.push(i);
      return acc;
    }, []);
  }, [data, filters]);

  // Auto-generate AI instructions
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a data transformation assistant. Apply the described transformation to each row.");
    lines.push("");

    if (systemPrompt.trim()) {
      lines.push("TRANSFORMATION:");
      lines.push(systemPrompt.trim());
      lines.push("");
    }

    if (selectedCols.length > 0) {
      lines.push("SELECTED COLUMNS:");
      selectedCols.forEach((c) => lines.push(`- ${c}`));
      lines.push("");
    }

    const activeFilters = filters.filter((f) => f.col && f.val);
    if (activeFilters.length > 0) {
      const opLabels: Record<FilterOp, string> = {
        contains: "contains", equals: "equals",
        starts: "starts with", ends: "ends with",
        gt: ">", lt: "<", gte: ">=", lte: "<=",
      };
      lines.push("FILTER CONDITIONS (AND logic):");
      activeFilters.forEach((f) => {
        lines.push(`- ${f.col} ${opLabels[f.op]} "${f.val}"`);
      });
      lines.push("");
    }

    // Store output column name(s) for session restore
    if (outputMode === "separate") {
      lines.push("OUTPUT COLUMNS:");
      selectedCols.slice().sort().forEach((col) => lines.push(`- ${outputColMap[col]}`));
    } else {
      lines.push(`OUTPUT COLUMN: ${outputCol}`);
    }
    lines.push("");

    lines.push("RULES:");
    lines.push("- Return ONLY the transformed result as plain text — no JSON, no markdown, no formatting");
    lines.push("- Do not include any explanation, labels, or commentary");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [systemPrompt, selectedCols, filters, outputMode, outputCol, outputColMap]);

  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  const batch = useBatchProcessor({
    toolId: "/transform",
    runType: "transform",
    activeModel,
    systemSettings,
    data,
    dataName,
    systemPrompt: aiInstructions,
    validate: () => {
      if (!systemPrompt.trim()) return "Enter AI instructions first";
      if (selectedCols.length === 0) return "Select at least one column";
      if (selectedRows.size === 0) return "No rows selected";
      return null;
    },
    selectData: (_data: Row[], mode: RunMode) => {
      return mode === "preview" ? _data.slice(0, 3)
        : mode === "test" ? _data.slice(0, 10)
        : _data;
    },
    processRow: async (row: Row, idx: number) => {
      // Strip status/latency so they always appear last
      const base: Row = {};
      for (const [k, v] of Object.entries(row)) {
        if (k !== "status" && k !== "latency_ms") base[k] = v;
      }

      if (!selectedRows.has(idx)) {
        if (outputMode === "separate") {
          const empties: Row = {};
          for (const col of selectedCols) empties[outputColMap[col]] = "";
          return { ...base, ...empties, status: "filtered", latency_ms: 0 };
        }
        return { ...base, [outputCol]: "", status: "filtered", latency_ms: 0 };
      }

      if (outputMode === "separate") {
        // One LLM call per selected column — each call gets a prompt scoped to that single column
        const outputs: Row = {};
        let totalLatency = 0;
        for (const col of selectedCols) {
          const perColPrompt = aiInstructions
            .replace(/OUTPUT COLUMNS:\n(- .+\n?)+/, `OUTPUT COLUMN: ${outputColMap[col]}`)
            .replace(/Return ONLY the transformed result as plain text/, `Return ONLY the transformed result for the column "${col}" as plain text`);
          const result = await dispatchProcessRow({
            provider: activeModel!.providerId,
            model: activeModel!.defaultModel,
            apiKey: activeModel!.apiKey || "",
            baseUrl: activeModel!.baseUrl,
            systemPrompt: perColPrompt,
            userContent: `${col}: ${String(row[col] ?? "")}`,
            temperature: systemSettings.temperature,
          });
          outputs[outputColMap[col]] = result.output.trim();
          totalLatency += result.latency;
        }
        return { ...base, ...outputs, status: "success", latency_ms: totalLatency };
      }

      // Combined mode — single call with all selected columns
      const subset: Row = {};
      selectedCols.forEach((col) => (subset[col] = row[col]));

      const result = await dispatchProcessRow({
        provider: activeModel!.providerId,
        model: activeModel!.defaultModel,
        apiKey: activeModel!.apiKey || "",
        baseUrl: activeModel!.baseUrl,
        systemPrompt: aiInstructions,
        userContent: Object.entries(subset).map(([k, v]) => `${k}: ${String(v ?? "")}`).join("\n"),
        temperature: systemSettings.temperature,
      });

      return { ...base, [outputCol]: result.output.trim(), status: "success", latency_ms: result.latency };
    },
    buildResultEntry: (r: Row, i: number) => {
      const input: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k !== "status" && k !== "latency_ms" && k !== "error_msg") {
          input[k] = v;
        }
      }
      return {
        rowIndex: i,
        input,
        output: outputMode === "separate"
          ? selectedCols.map((col) => String((r as Row)[outputColMap[col]] ?? "")).join(" | ")
          : String((r as Row)[outputCol] ?? ""),
        status: ((r as Row).status as string) ?? "success",
        latency: (r as Row).latency_ms as number | undefined,
        errorMessage: (r as Row).error_msg as string | undefined,
      };
    },
    onComplete: () => {
      // no-op; results handled by useBatchProcessor
    },
  });

  // ── Session restore from history ───────────────────────────────────────────
  const restored = useRestoreSession("transform");
  useEffect(() => {
    if (!restored) return;
    queueMicrotask(() => {
      const fullPrompt = restored.systemPrompt ?? "";

      // Extract the user's transformation prompt
      const transformMatch = fullPrompt.match(/TRANSFORMATION:\n([\s\S]*?)(?:\n\n|$)/);
      setSystemPrompt(transformMatch ? transformMatch[1].trim() : fullPrompt);

      // Restore selected columns
      let restoredCols: string[] = [];
      const colsMatch = fullPrompt.match(/SELECTED COLUMNS:\n([\s\S]*?)(?:\n\n|$)/);
      if (colsMatch) {
        restoredCols = colsMatch[1].split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean);
        setSelectedCols(restoredCols);
      }

      // Strip only the ai_output columns produced by THIS run (keep earlier ones)
      const runOutputCols = new Set<string>();
      const singleMatch = fullPrompt.match(/OUTPUT COLUMN: (.+)/);
      const multiMatch = fullPrompt.match(/OUTPUT COLUMNS:\n([\s\S]*?)(?:\n\n|$)/);
      if (singleMatch) {
        runOutputCols.add(singleMatch[1].trim());
        setOutputMode("combined");
      } else if (multiMatch) {
        multiMatch[1].split("\n").forEach((l) => {
          const col = l.replace(/^- /, "").trim();
          if (col) runOutputCols.add(col);
        });
        setOutputMode("separate");
      }

      const cleanData = restored.data.map((row) => {
        const clean: Row = {};
        for (const [k, v] of Object.entries(row)) {
          if (!runOutputCols.has(k)) clean[k] = v;
        }
        return clean;
      });
      setData(cleanData);
      setDataName(restored.dataName);

      // Restore filters and apply them to determine selected rows
      const filtersMatch = fullPrompt.match(/FILTER CONDITIONS \(AND logic\):\n([\s\S]*?)(?:\n\n|$)/);
      let restoredFilters: FilterEntry[] | null = null;
      if (filtersMatch) {
        const opMap: Record<string, FilterOp> = { ">": "gt", "<": "lt", ">=": "gte", "<=": "lte", contains: "contains", equals: "equals", "starts with": "starts", "ends with": "ends" };
        const parsed = filtersMatch[1].split("\n").map((l) => {
          const m = l.match(/^- (.+?) (contains|equals|starts with|ends with|>=|<=|>|<) "(.+)"$/);
          if (!m) return null;
          return { col: m[1], op: opMap[m[2]] ?? "contains" as FilterOp, val: m[3] };
        }).filter((f): f is FilterEntry => f !== null);
        if (parsed.length > 0) {
          setFilters(parsed);
          restoredFilters = parsed;
        }
      }

      // Apply restored filters to compute selected rows (matching filteredIndices logic)
      if (restoredFilters && restoredFilters.length > 0) {
        const indices = cleanData.reduce<number[]>((acc, row, i) => {
          const allMatch = restoredFilters!.every((f) => {
            const raw = row[f.col];
            const val = String(raw ?? "").toLowerCase();
            const fv = f.val.toLowerCase();
            if (f.op === "contains") return val.includes(fv);
            if (f.op === "equals") return val === fv;
            if (f.op === "starts") return val.startsWith(fv);
            if (f.op === "ends") return val.endsWith(fv);
            const numA = Number(raw);
            const numB = Number(f.val);
            if (f.op === "gt") return numA > numB;
            if (f.op === "lt") return numA < numB;
            if (f.op === "gte") return numA >= numB;
            if (f.op === "lte") return numA <= numB;
            return true;
          });
          if (allMatch) acc.push(i);
          return acc;
        }, []);
        setSelectedRows(new Set(indices));
      } else {
        setSelectedRows(new Set(cleanData.map((_, i) => i)));
      }

      // Populate results in global processing store
      const errors = restored.results.filter((r) => r.status === "error").length;
      useProcessingStore.getState().completeJob(
        "/transform",
        restored.results,
        { success: restored.results.length - errors, errors, avgLatency: 0 },
        restored.runId,
      );
      toast.success(`Restored session from "${restored.dataName}" (${restored.data.length} rows)`);
    });
  }, [restored, setSystemPrompt]);

  const handleDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    setSelectedRows(new Set(newData.map((_, i) => i)));
    setFilters([{ col: "", op: "contains", val: "" }]);
    setOutputMode("combined");
    batch.clearResults();

    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const handleLoadSample = (key: string) => {
    const ds = SAMPLE_DATASETS[key];
    if (ds) handleDataLoaded(ds.data as Row[], ds.name);
  };

  const updateFilter = (index: number, patch: Partial<FilterEntry>) => {
    setFilters((prev) => prev.map((f, i) => {
      if (i !== index) return f;
      const updated = { ...f, ...patch };
      // Reset operator when column changes and current op isn't valid for new type
      if (patch.col && patch.col !== f.col) {
        const type = colTypes[patch.col] ?? "text";
        const validOps = OPS_BY_TYPE[type].map((o) => o.value);
        if (!validOps.includes(updated.op)) updated.op = validOps[0];
      }
      return updated;
    }));
  };

  const removeFilter = (index: number) => {
    setFilters((prev) => (prev.length <= 1 ? [{ col: "", op: "contains", val: "" }] : prev.filter((_, i) => i !== index)));
  };

  return (
    <div className="space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">Transform Data</h1>
          <p className="text-muted-foreground text-sm">Apply AI transformations to each row of your dataset</p>
        </div>
        {data.length > 0 && (
          <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("transform_"); setData([]); setDataName(""); setSelectedCols([]); setSelectedRows(new Set()); setSystemPrompt(""); setFilters([{ col: "", op: "contains", val: "" }]); setAiInstructions(""); setOutputMode("combined"); batch.clearResults(); }}>
            <RotateCcw className="h-3.5 w-3.5" /> Start Over
          </Button>
        )}
      </div>

      <div className={batch.isProcessing ? "pointer-events-none opacity-60" : ""}>
      {/* ── 1. Upload Data ────────────────────────────────────────────────── */}
      <div ref={uploadRef} className="space-y-4 pb-8">
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

      {/* ── 2. Define Columns ─────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Define Columns</h2>
        <ColumnSelector
          allColumns={allColumns}
          selectedCols={selectedCols}
          onToggleCol={toggleCol}
          onToggleAll={toggleAll}
          description="Choose which columns to send to the AI for each row."
        />
        {selectedCols.length >= 2 && (
          <div className="pt-3">
            <label className="text-sm font-medium text-muted-foreground mb-2 block">Output mode</label>
            <Tabs value={outputMode} onValueChange={(v) => setOutputMode(v as OutputMode)}>
              <TabsList className="!h-auto p-1 w-full max-w-md">
                <TabsTrigger value="combined" className="flex-1 flex flex-col items-center gap-0 py-1.5 h-auto whitespace-normal">
                  <span className="text-xs font-medium">Combined (by default)</span>
                  <span className="text-[10px] text-muted-foreground font-normal">1 combined ai_output column</span>
                </TabsTrigger>
                <TabsTrigger value="separate" className="flex-1 flex flex-col items-center gap-0 py-1.5 h-auto whitespace-normal">
                  <span className="text-xs font-medium">Separate</span>
                  <span className="text-[10px] text-muted-foreground font-normal">{selectedCols.length} separate ai_output columns</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}
      </div>

      {/* ── 2b. Filter Rows ───────────────────────────────────────────────── */}
      {data.length > 0 && (
        <div className="space-y-4 py-8">
          <div className="border-t mb-4" />
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Filter Rows</h3>
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium"><strong>{selectedRows.size}</strong> of {data.length} rows selected</span>
              <button onClick={() => setSelectedRows(new Set(data.map((_, i) => i)))} className="text-xs underline text-muted-foreground hover:text-foreground">All</button>
              <button onClick={() => setSelectedRows(new Set())} className="text-xs underline text-muted-foreground hover:text-foreground">None</button>
            </div>
          </div>
          <div className="space-y-2">
            {filters.map((f, idx) => (
              <div key={idx} className="flex items-center gap-2 flex-wrap">
                <Select value={f.col} onValueChange={(v) => updateFilter(idx, { col: v })}>
                  <SelectTrigger className="h-9 text-sm w-[200px]"><SelectValue placeholder="Column..." /></SelectTrigger>
                  <SelectContent>
                    {allColumns.map((c) => <SelectItem key={c} value={c} className="text-sm">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={f.op} onValueChange={(v) => updateFilter(idx, { op: v as FilterOp })}>
                  <SelectTrigger className="h-9 text-sm w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(OPS_BY_TYPE[colTypes[f.col] ?? "text"]).map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={f.val} onChange={(e) => updateFilter(idx, { val: e.target.value })} placeholder="Value..." className="h-9 text-sm w-[200px]" />
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => removeFilter(idx)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFilters((prev) => [...prev, { col: "", op: "contains", val: "" }])}>
              <Plus className="h-3 w-3 mr-1" /> Add Filter
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSelectedRows(new Set(filteredIndices))}>
              Apply Filter
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilters([{ col: "", op: "contains", val: "" }]); setSelectedRows(new Set(data.map((_, i) => i))); }}>
              Clear All
            </Button>
          </div>
        </div>
      )}

      <div className="border-t" />

      {/* ── 3. Describe Transformation ─────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Describe Transformation</h2>
        <PromptEditor
          value={systemPrompt}
          onChange={setSystemPrompt}
          placeholder="Example: Translate the text to French, keeping the original formatting intact."
          examplePrompts={EXAMPLE_PROMPTS}
          helpText="Describe how to transform the selected columns. The AI processes each row individually."
        />
        <NoModelWarning activeModel={activeModel} />
      </div>

      <div className="border-t" />

      {/* ── 4. AI Instructions ─────────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={4}
        value={aiInstructions}
        onChange={setAiInstructions}
      />

      </div>

      <div className="border-t" />

      {/* ── 5. Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">5. Execute</h2>
        <ExecutionPanel
          isProcessing={batch.isProcessing}
          aborting={batch.aborting}
          runMode={batch.runMode}
          progress={batch.progress}
          etaStr={batch.etaStr}
          dataCount={data.length}
          disabled={data.length === 0 || !activeModel || !systemPrompt.trim() || selectedCols.length === 0}
          onRun={batch.run}
          onAbort={batch.abort}
          onResume={batch.resume}
          onCancel={batch.clearResults}
          failedCount={batch.failedCount}
          skippedCount={batch.skippedCount}
          testLabel={`Test (${Math.min(10, data.length)} rows — ${Math.min(10, selectedRows.size)} to transform)`}
          fullLabel={`Full Run (${data.length} rows — ${selectedRows.size} to transform)`}
        />
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      <ResultsPanel
        results={batch.results}
        runId={batch.runId}
        title="Results"
        subtitle={`${batch.results.length} rows total — ${batch.results.filter(r => (r as Row).status === "success").length} transformed`}
        extraActions={
          <Button variant="destructive" className="gap-2 px-5" onClick={() => {
            const cleaned = batch.results.map((r) => {
              const row = { ...(r as Row) };
              delete row.status;
              delete row.latency_ms;
              return row;
            });
            setData(cleaned);
            setDataName(dataName);
            setSelectedCols([]);
            setSelectedRows(new Set(batch.results.map((_, i) => i)));
            batch.clearResults();
            toast.success("Results loaded as new input data");
            uploadRef.current?.scrollIntoView({ behavior: "smooth" });
          }}>
            <Upload className="h-4 w-4 mr-2" /> Append ai_output
          </Button>
        }
      />
    </div>
  );
}
