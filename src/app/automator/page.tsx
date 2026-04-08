"use client";

import React, { useState, useEffect, useCallback } from "react";
import { UploadPreview } from "@/components/tools/UploadPreview";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { ExecutionPanel } from "@/components/tools/ExecutionPanel";
import { ResultsPanel } from "@/components/tools/ResultsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useRestoreSession } from "@/hooks/useRestoreSession";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { useProcessingStore } from "@/lib/processing-store";
import {
  dispatchAutomatorRow,
} from "@/lib/llm-dispatch";
import {
  Plus,
  X,
  Trash2,
  ArrowRight,
  Settings2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

interface OutputField {
  name: string;
  type: string;
  constraints: string;
}

interface Step {
  id: string;
  name: string;
  task: string;
  input_fields: string[];
  output_fields: OutputField[];
}

type Row = Record<string, unknown>;

const STEPS_KEY = "handai_steps_automator";
const MAX_ROW_RETRIES = 3;

function makeStep(idx: number): Step {
  return {
    id: Math.random().toString(36).substr(2, 9),
    name: `Step ${idx}`,
    task: "",
    input_fields: [],
    output_fields: [{ name: "result", type: "text", constraints: "" }],
  };
}

export default function AutomatorPage() {
  const [data, setData] = useSessionState<Row[]>("automator_data", []);
  const [dataName, setDataName] = useSessionState("automator_dataName", "");
  const [availableCols, setAvailableCols] = useSessionState<string[]>("automator_availableCols", []);
  const [steps, setSteps] = useState<Step[]>([makeStep(1), makeStep(2)]);
  const [isMounted, setIsMounted] = useState(false);

  const provider = useActiveModel();
  const systemSettings = useSystemSettings();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STEPS_KEY);
      if (saved) setSteps(JSON.parse(saved) as Step[]);
    } catch {}
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    localStorage.setItem(STEPS_KEY, JSON.stringify(steps));
  }, [steps, isMounted]);

  const handleDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    if (newData.length > 0) setAvailableCols(Object.keys(newData[0]));
    batch.clearResults();
    toast.success(`Loaded ${newData.length} rows`);
  };

  const handleLoadSample = (key: string) => {
    const ds = SAMPLE_DATASETS[key];
    if (ds) handleDataLoaded(ds.data as Row[], ds.name);
  };

  const addStep = () => setSteps((prev) => [...prev, makeStep(prev.length + 1)]);
  const removeStep = (id: string) => {
    if (steps.length === 1) return;
    setSteps((prev) => prev.filter((s) => s.id !== id));
  };
  const updateStep = (id: string, updates: Partial<Step>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));

  const addFieldToStep = (stepId: string) =>
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, output_fields: [...s.output_fields, { name: "", type: "text", constraints: "" }] }
          : s
      )
    );

  const updateFieldInStep = (stepId: string, fieldIdx: number, updates: Partial<OutputField>) =>
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, output_fields: s.output_fields.map((f, i) => (i === fieldIdx ? { ...f, ...updates } : f)) }
          : s
      )
    );

  const removeFieldFromStep = (stepId: string, fieldIdx: number) =>
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, output_fields: s.output_fields.filter((_, i) => i !== fieldIdx) }
          : s
      )
    );

  const getFieldsForStep = (stepIdx: number): string[] => {
    const fields = [...availableCols];
    for (let i = 0; i < stepIdx; i++) {
      steps[i].output_fields.forEach((f) => {
        if (f.name && !fields.includes(f.name)) fields.push(f.name);
      });
    }
    return fields;
  };

  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a multi-step data pipeline assistant.");
    lines.push("");
    lines.push("PIPELINE STEPS:");
    steps.forEach((step, idx) => {
      lines.push(`Step ${idx + 1}: ${step.name}`);
      if (step.task) lines.push(`  Task: ${step.task}`);
      if (step.input_fields.length > 0) lines.push(`  Input: ${step.input_fields.join(", ")}`);
      if (step.output_fields.length > 0) lines.push(`  Output: ${step.output_fields.map(f => `${f.name}(${f.type})`).join(", ")}`);
    });
    lines.push("");
    lines.push("RULES:");
    lines.push("- Execute each step in order");
    lines.push("- Return only the pipeline output fields");
    lines.push("- Do not include any explanation or commentary — return only the result unless the user explicitly requests an explanation");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);
    return lines.join("\n");
  }, [steps]);

  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  const batch = useBatchProcessor({
    toolId: "/automator",
    runType: "automator",
    activeModel: provider,
    systemSettings,
    data,
    dataName,
    systemPrompt: aiInstructions || JSON.stringify(steps),
    validate: () => {
      if (steps.some((s) => !s.task.trim())) return "All steps need a task description";
      return null;
    },
    processRow: async (row: Row) => {
      const t0 = Date.now();
      for (let attempt = 1; attempt <= MAX_ROW_RETRIES; attempt++) {
        try {
          const result = await dispatchAutomatorRow({
            row,
            steps,
            provider: provider!.providerId,
            model: provider!.defaultModel,
            apiKey: provider!.apiKey || "",
            baseUrl: provider!.baseUrl,
          });

          // Check if result.output is essentially the same as input (extraction failed silently)
          const outputKeys = Object.keys(result.output || {});
          const inputKeys = Object.keys(row);
          const newKeys = outputKeys.filter(k => !inputKeys.includes(k) && k !== 'status' && k !== 'latency');
          if (newKeys.length === 0 && steps.length > 0 && attempt < MAX_ROW_RETRIES) {
            await new Promise(r => setTimeout(r, 500 * attempt));
            continue;
          }
          // Unwrap nested objects to avoid "[object Object]" or '{"text":"..."}' in table cells
          const flatOutput: Row = {};
          for (const [k, v] of Object.entries(result.output)) {
            if (v !== null && typeof v === "object" && !Array.isArray(v)) {
              // LLM sometimes wraps value in {"text":"..."} or {"number":...} — unwrap single-key objects
              const entries = Object.entries(v as Record<string, unknown>);
              if (entries.length === 1) {
                flatOutput[k] = typeof entries[0][1] === "object" ? JSON.stringify(entries[0][1]) : entries[0][1];
              } else {
                flatOutput[k] = JSON.stringify(v);
              }
            } else if (Array.isArray(v)) {
              flatOutput[k] = v.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ");
            } else {
              flatOutput[k] = v;
            }
          }
          if (newKeys.length === 0 && steps.length > 0) {
            return {
              ...row,
              ...flatOutput,
              _step_warning: "No new fields extracted — check step configuration",
              status: "warning",
              latency_ms: Date.now() - t0,
            };
          }
          return { ...flatOutput, status: "success", latency_ms: Date.now() - t0 };
        } catch (err) {
          if (attempt === MAX_ROW_RETRIES) {
            return {
              ...row,
              automator_error: true,
              status: "error",
              error_msg: String(err),
              latency_ms: Date.now() - t0,
            };
          }
          await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
      return { ...row, status: "error", error_msg: "Retry limit reached", latency_ms: Date.now() - t0 };
    },
    buildResultEntry: (r: Row, i: number) => {
      // Separate original input fields from pipeline output fields
      const outputFieldNames = new Set(
        steps.flatMap((s) => s.output_fields.map((f) => f.name))
      );
      const metaKeys = new Set(["status", "latency_ms", "error_msg", "automator_error", "_step_warning"]);
      const input: Record<string, unknown> = {};
      const output: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (metaKeys.has(k)) continue;
        if (outputFieldNames.has(k)) {
          output[k] = v;
        } else {
          input[k] = v;
        }
      }
      return {
        rowIndex: i,
        input,
        output: Object.keys(output).length > 0 ? output : (r.status === "error" ? "" : JSON.stringify(r)),
        status: (r.status as string) ?? "success",
        latency: r.latency_ms as number | undefined,
        errorMessage: r.error_msg as string | undefined,
      };
    },
  });

  // ── Session restore from history ───────────────────────────────────────────
  const restored = useRestoreSession("automator");
  useEffect(() => {
    if (!restored) return;
    queueMicrotask(() => {
      const fullPrompt = restored.systemPrompt ?? "";

      // Restore pipeline steps from "PIPELINE STEPS:" section
      const restoredSteps: Step[] = [];
      const stepsMatch = fullPrompt.match(/PIPELINE STEPS:\n([\s\S]*?)(?:\n\nRULES:|$)/);
      if (stepsMatch) {
        const stepBlocks = stepsMatch[1].trim().split(/(?=Step \d+:)/);
        for (const block of stepBlocks) {
          const nameMatch = block.match(/^Step \d+:\s*(.+)/);
          if (!nameMatch) continue;
          const taskMatch = block.match(/Task:\s*(.+)/);
          const inputMatch = block.match(/Input:\s*(.+)/);
          const outputMatch = block.match(/Output:\s*(.+)/);
          restoredSteps.push({
            id: crypto.randomUUID(),
            name: nameMatch[1].trim(),
            task: taskMatch ? taskMatch[1].trim() : "",
            input_fields: inputMatch ? inputMatch[1].split(",").map((f) => f.trim()).filter(Boolean) : [],
            output_fields: outputMatch
              ? outputMatch[1].split(",").map((f) => {
                  const m = f.trim().match(/^(.+?)\((\w+)\)$/);
                  return m
                    ? { name: m[1].trim(), type: m[2], constraints: "" }
                    : { name: f.trim(), type: "text", constraints: "" };
                }).filter((f) => f.name)
              : [{ name: "", type: "text", constraints: "" }],
          });
        }
        if (restoredSteps.length > 0) {
          setSteps(restoredSteps);
          localStorage.setItem(STEPS_KEY, JSON.stringify(restoredSteps));
        }
      }

      // Strip pipeline output fields and meta fields from data to get clean input
      const outputFieldNames = new Set(
        restoredSteps.flatMap((s) => s.output_fields.map((f) => f.name))
      );
      const metaKeys = new Set(["status", "latency_ms", "error_msg", "automator_error", "_step_warning", "output"]);
      const cleanData = restored.data.map((row) => {
        const clean: Row = {};
        for (const [k, v] of Object.entries(row)) {
          if (!outputFieldNames.has(k) && !metaKeys.has(k)) clean[k] = v;
        }
        return clean;
      });
      setData(cleanData);
      setDataName(restored.dataName);
      if (cleanData.length > 0) setAvailableCols(Object.keys(cleanData[0]));

      // Populate results in global processing store
      const errors = restored.results.filter((r) => r.status === "error").length;
      useProcessingStore.getState().completeJob(
        "/automator",
        restored.results,
        { success: restored.results.length - errors, errors, avgLatency: 0 },
        restored.runId,
      );
      toast.success(`Restored session from "${restored.dataName}" (${restored.data.length} rows)`);
    });
  }, [restored]);

  return (
    <div className="space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">General Automator</h1>
          <p className="text-muted-foreground text-sm">Create and run multi-step AI data pipelines</p>
        </div>
        {data.length > 0 && (
          <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("automator_"); setData([]); setDataName(""); setAvailableCols([]); setSteps([makeStep(1), makeStep(2)]); localStorage.removeItem(STEPS_KEY); setAiInstructions(""); batch.clearResults(); }}>
            <RotateCcw className="h-3.5 w-3.5" /> Start Over
          </Button>
        )}
      </div>

      <div className={batch.isProcessing ? "pointer-events-none opacity-60" : ""}>
      {/* ── 1. Upload Data ────────────────────────────────────────────────── */}
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

      {/* ── 2. Build Pipeline ─────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">2. Build Pipeline</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5" />
            <span>{dataName || "No data"}</span>
            {steps.map((s) => (
              <React.Fragment key={s.id}>
                <span className="text-muted-foreground/40">→</span>
                <span className="text-indigo-600 font-medium">{s.name}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Step cards */}
        <div className="space-y-4">
          {steps.map((step, idx) => (
            <div
              key={step.id}
              className="border rounded-lg overflow-hidden border-indigo-100 hover:border-indigo-200 transition-colors"
            >
              <div className="px-4 py-3 border-b bg-indigo-50/40 dark:bg-indigo-950/20 flex items-center gap-3">
                <div className="h-6 w-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                  {idx + 1}
                </div>
                <Input
                  className="h-7 flex-1 font-semibold text-sm bg-transparent border-none p-0 focus-visible:ring-0"
                  value={step.name}
                  onChange={(e) => updateStep(step.id, { name: e.target.value })}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 text-destructive border-destructive/30 hover:bg-destructive hover:text-destructive-foreground shrink-0"
                  onClick={() => removeStep(step.id)}
                  disabled={steps.length === 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="p-4 space-y-4">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Task Description</Label>
                  <Textarea
                    className="min-h-[80px] text-sm font-mono placeholder:font-sans resize-y"
                    placeholder="Describe what this step does (e.g. 'Summarize the input text into 3 bullet points')"
                    value={step.task}
                    onChange={(e) => updateStep(step.id, { task: e.target.value })}
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  {/* Input fields */}
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center justify-between">
                      Input Fields <Settings2 className="h-3 w-3 opacity-40" />
                    </Label>
                    <div className="p-3 border rounded-lg bg-muted/10 min-h-[80px]">
                      <div className="flex flex-wrap gap-1.5">
                        {getFieldsForStep(idx).map((field) => (
                          <button
                            key={field}
                            onClick={() => {
                              const cur = step.input_fields;
                              updateStep(step.id, {
                                input_fields: cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field],
                              });
                            }}
                            className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                              step.input_fields.includes(field)
                                ? "bg-indigo-500 text-white border-indigo-600"
                                : "bg-white dark:bg-muted text-muted-foreground border-muted-foreground/20 hover:bg-muted"
                            }`}
                          >
                            {field}
                          </button>
                        ))}
                        {getFieldsForStep(idx).length === 0 && (
                          <span className="text-[11px] text-muted-foreground italic">No fields available yet</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Output fields */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Output Fields</Label>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => addFieldToStep(step.id)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="space-y-1.5 border rounded-lg p-2 bg-muted/10">
                      {step.output_fields.map((field, fieldIdx) => (
                        <div key={fieldIdx} className="flex gap-1.5 items-center group">
                          <Input
                            className="h-7 text-[11px] flex-1"
                            placeholder="Field Name"
                            value={field.name}
                            onChange={(e) => updateFieldInStep(step.id, fieldIdx, { name: e.target.value })}
                          />
                          <select
                            className="h-7 text-[11px] border rounded bg-background px-1"
                            value={field.type}
                            onChange={(e) => updateFieldInStep(step.id, fieldIdx, { type: e.target.value })}
                          >
                            <option value="text">Text</option>
                            <option value="number">Number</option>
                          </select>
                          {step.output_fields.length > 1 && (
                            <button
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => removeFieldFromStep(step.id, fieldIdx)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          className="w-full border-dashed border-2 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 hover:border-indigo-300"
          onClick={addStep}
        >
          <Plus className="h-4 w-4 mr-2" /> Add Step
        </Button>
      </div>

      <div className="border-t" />

      {/* ── 3. AI Instructions ─────────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={3}
        value={aiInstructions}
        onChange={setAiInstructions}
      />

      </div>

      <div className="border-t" />

      {/* ── 4. Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">4. Execute</h2>
        <NoModelWarning activeModel={provider} />
        <ExecutionPanel
          isProcessing={batch.isProcessing}
          aborting={batch.aborting}
          runMode={batch.runMode}
          progress={batch.progress}
          etaStr={batch.etaStr}
          dataCount={data.length}
          disabled={data.length === 0 || !provider || steps.some((s) => !s.task.trim())}
          onRun={batch.run}
          onAbort={batch.abort}
          onResume={batch.resume}
          onCancel={batch.clearResults}
          failedCount={batch.failedCount}
          skippedCount={batch.skippedCount}
          fullLabel={`Full Run (${data.length} rows)`}
        />
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      <ResultsPanel
        results={batch.results}
        runId={batch.runId}
        title="Results"
        subtitle={`${batch.results.length} rows · ${steps.length}-step pipeline`}
      >
        {(() => {
          const warnings = batch.results.filter(r => r.status === "warning").length;
          const errors = batch.results.filter(r => r.status === "error").length;
          if (warnings === 0 && errors === 0) return null;
          return (
            <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 text-sm">
              {errors > 0 && <span className="text-red-600">{errors} errors</span>}
              {warnings > 0 && <span className="text-amber-600">{warnings} rows with extraction warnings</span>}
            </div>
          );
        })()}
      </ResultsPanel>
    </div>
  );
}
