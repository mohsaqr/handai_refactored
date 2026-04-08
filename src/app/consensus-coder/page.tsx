"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/lib/store";
import { useSystemSettings } from "@/lib/hooks";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useRestoreSession } from "@/hooks/useRestoreSession";
import { useProcessingStore } from "@/lib/processing-store";
import { HelpCircle, Plus, X, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { dispatchConsensusRow } from "@/lib/llm-dispatch";
import { UploadPreview } from "@/components/tools/UploadPreview";
import { ColumnSelector } from "@/components/tools/ColumnSelector";
import { useColumnSelection } from "@/hooks/useColumnSelection";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { ExecutionPanel } from "@/components/tools/ExecutionPanel";
import { ResultsPanel } from "@/components/tools/ResultsPanel";

type Row = Record<string, unknown>;

const DEFAULT_WORKER_PROMPT = `You are an independent coder in an inter-rater reliability study. Code this text based on the instructions.

CODING RULES:
- Apply the codes the text genuinely speaks to — multi-coding is appropriate when multiple themes are present.
- Consider both explicit statements and implied meaning.
- Be consistent: apply the same standard to every text segment.
- Output ONLY the codes or values requested. No explanations, no commentary.
- Plain text only. No markdown, no headings, no code fences.`;

const DEFAULT_JUDGE_PROMPT = `You are a senior researcher adjudicating between independent coders.

PROCEDURE:
1. Identify codes where all workers agree — accept these.
2. For disagreements, re-read the original text and evaluate against the codebook.
3. Favor inclusion when evidence is ambiguous but present.
4. Produce the final consolidated answer.

OUTPUT: Return ONLY the final answer. No explanations, no reasoning, no commentary.`;

const SAMPLE_JUDGE_PROMPTS: Record<string, string> = {
  "Strict consensus": `Only accept a result if ALL workers agree. If any worker disagrees, flag the row as "DISAGREEMENT" and do not pick a winner.\n\nRULES:\n- Output the agreed answer, or "DISAGREEMENT" if workers differ\n- No explanations, no reasoning, no commentary`,
  "Majority vote": `Pick the answer that the majority of workers agree on. If there is a tie, pick the answer from the highest-ranked worker.\n\nRULES:\n- Output the majority answer directly\n- If tied, prefer Worker 1's answer\n- No explanations, no reasoning, no commentary`,
  "Best quality pick": `Evaluate each worker's output for accuracy, completeness, and clarity. Pick the single best response.\n\nRULES:\n- Output the best answer directly\n- No explanations, no reasoning, no commentary`,
  "Synthesize all": `Combine the best parts of all worker outputs into one comprehensive answer.\n\nRULES:\n- Merge insights from all workers into a single coherent response\n- Do not simply copy one worker — synthesize\n- No explanations, no reasoning, no commentary`,
};

interface WorkerConfig {
  providerId: string;
  model: string;
}

interface KappaStats {
  kappa: number | null;
  kappaLabel: string;
}

function providerLabel(id: string) {
  if (id === "lmstudio") return "LM Studio";
  if (id === "ollama") return "Ollama";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function WorkerCard({ label, cfg, setCfg, enabledProviders }: {
  label: string;
  cfg: WorkerConfig;
  setCfg: (c: WorkerConfig) => void;
  enabledProviders: { providerId: string; defaultModel: string; isEnabled: boolean; apiKey?: string; baseUrl?: string; isLocal?: boolean }[];
}) {
  return (
    <div className="space-y-3">
      <div className="text-base font-bold">{label}</div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Provider</Label>
        <Select value={cfg.providerId} onValueChange={(v) => setCfg({ ...cfg, providerId: v })}>
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {enabledProviders.map((p) => (
              <SelectItem key={p.providerId} value={p.providerId} className="text-sm">
                {providerLabel(p.providerId)}
              </SelectItem>
            ))}
            {enabledProviders.length === 0 && (
              <SelectItem value={cfg.providerId} className="text-sm">No providers configured</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Model</Label>
        <Input
          value={cfg.model}
          onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
          placeholder="Model ID (e.g. gpt-4o)"
          className="text-sm font-mono"
        />
      </div>
    </div>
  );
}

export default function ConsensusCoderPage() {
  const [data, setData] = useSessionState<Row[]>("consensus_data", []);
  const [dataName, setDataName] = useSessionState("consensus_dataName", "");
  const [workerPrompt, setWorkerPrompt] = useSessionState("consensus_workerPrompt", "");
  const [judgePrompt, setJudgePrompt] = useSessionState("consensus_judgePrompt", "");
  const [kappaStats, setKappaStats] = useSessionState<KappaStats | null>("consensus_kappaStats", null);

  const [extraWorkers, setExtraWorkers] = useSessionState<WorkerConfig[]>("consensus_extraWorkers", []);
  const [includeJudgeReasoning, setIncludeJudgeReasoning] = useSessionState("consensus_includeJudgeReasoning", true);
  const [enableQualityScoring, setEnableQualityScoring] = useSessionState("consensus_enableQualityScoring", false);
  const [enableDisagreementAnalysis, setEnableDisagreementAnalysis] = useSessionState("consensus_enableDisagreementAnalysis", false);

  const providers = useAppStore((state) => state.providers);
  const systemSettings = useSystemSettings();
  const enabledProviders = Object.values(providers).filter((p) => p.isEnabled);
  const firstId = enabledProviders[0]?.providerId ?? "openai";
  const firstModel = enabledProviders[0]?.defaultModel ?? "gpt-4o";
  const secondId = enabledProviders[1]?.providerId ?? firstId;
  const secondModel = enabledProviders[1]?.defaultModel ?? firstModel;

  const [worker1, setWorker1] = useState<WorkerConfig>({ providerId: firstId, model: firstModel });
  const [worker2, setWorker2] = useState<WorkerConfig>({ providerId: secondId, model: secondModel });
  const [judge, setJudge] = useState<WorkerConfig>({ providerId: firstId, model: firstModel });

  // Sync worker/judge defaults once the Zustand store hydrates from localStorage
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || enabledProviders.length === 0) return;
    hydratedRef.current = true;
    const p1 = enabledProviders[0];
    const p2 = enabledProviders[1] ?? p1;
    setWorker1((prev) => prev.providerId === "openai" && !providers.openai?.isEnabled ? { providerId: p1.providerId, model: p1.defaultModel } : prev);
    setWorker2((prev) => prev.providerId === (enabledProviders[1]?.providerId ?? "openai") && !providers[prev.providerId]?.isEnabled ? { providerId: p2.providerId, model: p2.defaultModel } : prev);
    setJudge((prev) => prev.providerId === "openai" && !providers.openai?.isEnabled ? { providerId: p1.providerId, model: p1.defaultModel } : prev);
  }, [enabledProviders, providers]);

  const addWorker = () => setExtraWorkers((prev) => [...prev, { providerId: firstId, model: firstModel }]);
  const removeWorker = (idx: number) => setExtraWorkers((prev) => prev.filter((_, i) => i !== idx));
  const updateExtraWorker = (idx: number, cfg: WorkerConfig) => setExtraWorkers((prev) => prev.map((w, i) => (i === idx ? cfg : w)));

  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const { selectedCols, setSelectedCols, toggleCol, toggleAll } = useColumnSelection("consensus_selectedCols", allColumns, false);

  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("Consensus coding: multiple workers analyze each row, a judge picks the best answer.");
    lines.push("");
    lines.push("RULES:");
    lines.push("- All outputs MUST be plain text or CSV. NEVER use markdown formatting: no **, no ## headings, no bullet points, no code blocks, no backticks.");
    lines.push("- Workers: apply instructions directly, return values only. Do NOT explain or justify.");
    lines.push("- Judge: pick the best answer and output it directly. May add one short sentence of reasoning if needed.");
    lines.push("- Keep all outputs short and precise. No extra text beyond what was requested.");
    lines.push("");

    if (workerPrompt.trim()) {
      lines.push("WORKER INSTRUCTIONS:");
      lines.push(workerPrompt.trim());
      lines.push("");
    }

    if (judgePrompt.trim()) {
      lines.push("JUDGE INSTRUCTIONS:");
      lines.push(judgePrompt.trim());
      lines.push("");
    }

    if (selectedCols.length > 0) {
      lines.push("COLUMNS: " + selectedCols.join(", "));
      lines.push("");
    }

    lines.push(AI_INSTRUCTIONS_MARKER);
    return lines.join("\n");
  }, [workerPrompt, judgePrompt, selectedCols]);

  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  // Build a pseudo activeModel from the judge config for useBatchProcessor
  const judgeProvider = providers[judge.providerId];
  const activeModel = judgeProvider ? {
    ...judgeProvider,
    providerId: judge.providerId,
    defaultModel: judge.model,
  } : null;

  const batch = useBatchProcessor({
    toolId: "/consensus-coder",
    runType: "consensus-coder",
    activeModel,
    systemSettings,
    data,
    dataName,
    systemPrompt: aiInstructions,
    validate: () => {
      if (selectedCols.length === 0) return "Select at least one column";
      const p1 = providers[worker1.providerId];
      const p2 = providers[worker2.providerId];
      const pJ = providers[judge.providerId];
      if (!p1 || !p2 || !pJ) return "Invalid provider selection";
      if ((!p1.isLocal && !p1.apiKey) || (!p2.isLocal && !p2.apiKey) || (!pJ.isLocal && !pJ.apiKey)) {
        return "API keys missing. Check Settings.";
      }
      for (let i = 0; i < extraWorkers.length; i++) {
        const ep = providers[extraWorkers[i].providerId];
        if (!ep) return `Invalid Worker ${i + 3} provider`;
        if (!ep.isLocal && !ep.apiKey) return `API key missing for Worker ${i + 3}. Check Settings.`;
      }
      return null;
    },
    runParams: {
      provider: judge.providerId,
      model: judge.model,
      temperature: systemSettings.temperature,
    },
    processRow: async (row: Row, idx: number) => {
      const p1 = providers[worker1.providerId];
      const p2 = providers[worker2.providerId];
      const pJ = providers[judge.providerId];

      const workers = [
        { provider: worker1.providerId, model: worker1.model, apiKey: p1?.apiKey || "local", baseUrl: p1?.baseUrl },
        { provider: worker2.providerId, model: worker2.model, apiKey: p2?.apiKey || "local", baseUrl: p2?.baseUrl },
        ...extraWorkers.map((ew) => {
          const ep = providers[ew.providerId];
          return { provider: ew.providerId, model: ew.model, apiKey: ep?.apiKey || "local", baseUrl: ep?.baseUrl };
        }),
      ];

      const subset: Row = {};
      selectedCols.forEach((col) => (subset[col] = row[col]));

      const result = await dispatchConsensusRow({
        workers: workers.map((w) => ({ provider: w.provider, model: w.model, apiKey: w.apiKey || "", baseUrl: w.baseUrl })),
        judge: { provider: judge.providerId, model: judge.model, apiKey: pJ?.apiKey || "", baseUrl: pJ?.baseUrl },
        workerPrompt: workerPrompt.trim() || DEFAULT_WORKER_PROMPT,
        judgePrompt: judgePrompt.trim() || DEFAULT_JUDGE_PROMPT,
        userContent: JSON.stringify(subset),
        enableQualityScoring,
        enableDisagreementAnalysis,
        includeReasoning: includeJudgeReasoning,
        rowIdx: idx,
      });

      const workerCols: Record<string, string> = {};
      result.workerResults?.forEach((wr: { output: string }, i: number) => {
        workerCols[`worker_${i + 1}_output`] = wr?.output ?? "";
      });

      const qualityCols: Record<string, string> = {};
      if (result.qualityScores) {
        (result.qualityScores as number[]).forEach((score, i) => {
          qualityCols[`quality_score_w${i + 1}`] = String(score);
        });
      }

      return {
        ...row,
        ...workerCols,
        judge_output: result.judgeOutput,
        ...(includeJudgeReasoning ? { judge_reasoning: result.consensusType === "Unanimous" ? "Same workers' outputs" : (result.judgeReasoning ?? "") } : {}),
        consensus: result.consensusType,
        _row_kappa: result.kappa,
        kappa: "—",
        ...qualityCols,
        ...(enableDisagreementAnalysis ? { disagreement_reason: result.consensusType === "Unanimous" ? "No disagreement" : (result.disagreementReason ?? "") } : {}),
        status: "success",
      };
    },
    buildResultEntry: (r: Row, i: number) => ({
      rowIndex: i,
      input: r as Record<string, unknown>,
      output: (r.judge_output ?? "") as string,
      status: (r.consensus === "Error" ? "error" : "success") as string,
      errorMessage: r.error_msg as string | undefined,
    }),
    onComplete: (results: Row[]) => {
      // Compute running cumulative kappa and write into each row
      let sum = 0;
      let count = 0;
      for (const row of results) {
        if (row.status === "error" || row.status === "skipped") {
          row.kappa = "—";
          continue;
        }
        const rk = row._row_kappa as number | null;
        if (rk !== null && rk !== undefined && !isNaN(rk)) {
          sum += rk;
          count++;
        }
        row.kappa = count > 0 ? (sum / count).toFixed(3) : "—";
      }

      // Set final cumulative kappa in summary card
      if (count > 0) {
        const finalKappa = sum / count;
        let label = "Very Low";
        if (finalKappa >= 0.8) label = "Very High";
        else if (finalKappa >= 0.6) label = "High";
        else if (finalKappa >= 0.4) label = "Moderate";
        else if (finalKappa >= 0.2) label = "Low";
        setKappaStats({ kappa: finalKappa, kappaLabel: label });
      }
    },
  });

  // ── Session restore from history ───────────────────────────────────────────
  const restored = useRestoreSession("consensus-coder");
  React.useEffect(() => {
    if (!restored) return;
    queueMicrotask(() => {
      setData(restored.data as Row[]);
      setDataName(restored.dataName);

      const fullPrompt = restored.systemPrompt ?? "";

      // Restore worker instructions
      const workerMatch = fullPrompt.match(/WORKER INSTRUCTIONS:\n([\s\S]*?)(?:\n\n|$)/);
      setWorkerPrompt(workerMatch ? workerMatch[1].trim() : "");

      // Restore judge instructions
      const judgeMatch = fullPrompt.match(/JUDGE INSTRUCTIONS:\n([\s\S]*?)(?:\n\n|$)/);
      if (judgeMatch) setJudgePrompt(judgeMatch[1].trim());

      // Restore selected columns
      const colsMatch = fullPrompt.match(/COLUMNS: (.+)/);
      if (colsMatch) {
        const cols = colsMatch[1].split(",").map((c) => c.trim()).filter(Boolean);
        if (cols.length > 0) setSelectedCols(cols);
      }

      // Populate results in global processing store
      const errors = restored.results.filter((r) => r.status === "error").length;
      useProcessingStore.getState().completeJob(
        "/consensus-coder",
        restored.results as Row[],
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
    setKappaStats(null);
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const handleLoadSample = (key: string) => {
    const ds = SAMPLE_DATASETS[key];
    if (ds) handleDataLoaded(ds.data as Row[], ds.name);
  };

  return (
    <div className="space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">Consensus Coder</h1>
          <p className="text-muted-foreground text-sm">Multi-model consensus coding with inter-rater reliability (Cohen&apos;s Kappa)</p>
        </div>
        {data.length > 0 && (
          <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("consensus_"); setData([]); setDataName(""); setWorkerPrompt(""); setJudgePrompt(""); setKappaStats(null); setExtraWorkers([]); setIncludeJudgeReasoning(true); setEnableQualityScoring(false); setEnableDisagreementAnalysis(false); setAiInstructions(""); batch.clearResults(); }}>
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
          maxPreviewRows={5}
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

      {/* ── 2. Select Columns ─────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Define Columns</h2>
        <ColumnSelector
          allColumns={allColumns}
          selectedCols={selectedCols}
          onToggleCol={toggleCol}
          onToggleAll={toggleAll}
          description="Choose which columns to send to each worker model for coding."
          emptyMessage="Upload data first to see available columns."
        />
      </div>

      <div className="border-t" />

      {/* ── 3. Configure Workers & Judge ──────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Configure Workers &amp; Judge</h2>

        <div className="border rounded-lg p-5 space-y-5">
          <div className="grid grid-cols-2 gap-8">
            <WorkerCard label="Worker 1" cfg={worker1} setCfg={setWorker1} enabledProviders={enabledProviders} />
            <WorkerCard label="Worker 2" cfg={worker2} setCfg={setWorker2} enabledProviders={enabledProviders} />
            {extraWorkers.map((ew, idx) => (
              <div key={idx} className="relative">
                <WorkerCard label={`Worker ${idx + 3}`} cfg={ew} setCfg={(cfg) => updateExtraWorker(idx, cfg)} enabledProviders={enabledProviders} />
                <button
                  onClick={() => removeWorker(idx)}
                  className="absolute top-0 right-0 text-muted-foreground hover:text-destructive"
                  title={`Remove Worker ${idx + 3}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="col-start-1 flex items-start pt-1">
              <Button variant="outline" size="sm" className="text-xs" onClick={addWorker}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Worker
              </Button>
            </div>
          </div>

          <div className="border-t pt-5">
            <WorkerCard label="Judge" cfg={judge} setCfg={setJudge} enabledProviders={enabledProviders} />
          </div>
        </div>
      </div>

      <div className="border-t" />

      {/* ── 4. Prompts ────────────────────────────────────────────────────── */}
      <div className="space-y-5 py-8">
        <h2 className="text-2xl font-bold">4. Define Instructions</h2>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between h-7">
              <Label className="text-sm">Worker Instructions</Label>
            </div>
            <Textarea value={workerPrompt} onChange={(e) => setWorkerPrompt(e.target.value)} className="min-h-[200px] text-xs font-mono resize-y" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between h-7">
              <Label className="text-sm">Judge Instructions</Label>
              <Select onValueChange={(key) => { if (SAMPLE_JUDGE_PROMPTS[key]) setJudgePrompt(SAMPLE_JUDGE_PROMPTS[key]); }}>
                <SelectTrigger className="w-[160px] h-7 text-xs">
                  <SelectValue placeholder="Load sample..." />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(SAMPLE_JUDGE_PROMPTS).map((key) => (
                    <SelectItem key={key} value={key} className="text-xs">{key}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea value={judgePrompt} onChange={(e) => setJudgePrompt(e.target.value)} className="min-h-[200px] text-xs font-mono resize-y" />
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-bold">Enhanced Judge Features</div>
          <div className="grid grid-cols-3 gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={includeJudgeReasoning} onChange={(e) => setIncludeJudgeReasoning(e.target.checked)} className="accent-primary w-4 h-4" />
              <span className="text-sm">Include Judge Reasoning</span>
              <span title="Adds a column with the judge's reasoning for its choice">
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={enableQualityScoring} onChange={(e) => setEnableQualityScoring(e.target.checked)} className="accent-primary w-4 h-4" />
              <span className="text-sm">Quality Scoring</span>
              <span title="Judge assigns a quality score to each worker output">
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={enableDisagreementAnalysis} onChange={(e) => setEnableDisagreementAnalysis(e.target.checked)} className="accent-primary w-4 h-4" />
              <span className="text-sm">Disagreement Analysis</span>
              <span title="Adds a column explaining why workers disagreed">
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="border-t" />

      {/* ── 5. AI Instructions ─────────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={5}
        value={aiInstructions}
        onChange={setAiInstructions}
      />

      </div>

      <div className="border-t" />

      {/* ── 6. Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">6. Execute</h2>
        <ExecutionPanel
          isProcessing={batch.isProcessing}
          aborting={batch.aborting}
          runMode={batch.runMode}
          progress={batch.progress}
          etaStr={batch.etaStr}
          dataCount={data.length}
          disabled={data.length === 0 || selectedCols.length === 0}
          onRun={batch.run}
          onAbort={batch.abort}
          onResume={batch.resume}
          onCancel={batch.clearResults}
          failedCount={batch.failedCount}
          skippedCount={batch.skippedCount}
        />
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      <ResultsPanel
        results={batch.results}
        runId={batch.runId}
        title="Results"
        subtitle={`${batch.results.length} rows coded`}
      >
        {kappaStats && (
          <div className="flex items-center gap-8 px-5 py-4 rounded-lg border border-purple-200 bg-purple-50/30 dark:bg-purple-950/20">
            <div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Cohen&apos;s Kappa</div>
              <div className="text-3xl font-bold text-purple-600 mt-0.5">
                {kappaStats.kappa !== null ? kappaStats.kappa.toFixed(3) : "N/A"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Agreement Level</div>
              <div className="text-base font-semibold mt-0.5">{kappaStats.kappaLabel}</div>
            </div>
            <div className="flex-1 text-xs text-muted-foreground">
              Kappa measures inter-rater agreement beyond chance. 0 = chance, 1 = perfect, &lt;0 = less than chance.
            </div>
            {batch.runMode !== "full" && batch.results.length > 0 && (
              <span className="text-xs font-medium text-purple-600 border border-purple-200 px-2 py-0.5 rounded bg-purple-50 shrink-0">
                {batch.runMode === "preview" ? "Preview" : "Test"} run · {batch.results.length} of {data.length} rows
              </span>
            )}
          </div>
        )}
      </ResultsPanel>
    </div>
  );
}
