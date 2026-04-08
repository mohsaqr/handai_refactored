"use client";

import React, { useState, useCallback } from "react";
import { UploadPreview } from "@/components/tools/UploadPreview";
import { ColumnSelector } from "@/components/tools/ColumnSelector";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PromptEditor } from "@/components/tools/PromptEditor";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { useProcessingFlag } from "@/hooks/useProcessingFlag";
import { useRestoreSession } from "@/hooks/useRestoreSession";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useColumnSelection } from "@/hooks/useColumnSelection";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { getPrompt } from "@/lib/prompts";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { ResultsPanel } from "@/components/tools/ResultsPanel";
import { Loader2, CheckCircle2, X, RotateCcw, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Row } from "@/types";
import { dispatchProcessRow, dispatchCreateRun, dispatchSaveResults } from "@/lib/llm-dispatch";

type Stage = "idle" | "discovery" | "consolidation" | "definition" | "done";

const STAGE_LABELS: Record<Stage, string> = {
  idle: "Ready",
  discovery: "Stage 1: Discovering themes…",
  consolidation: "Stage 2: Consolidating themes…",
  definition: "Stage 3: Writing definitions…",
  done: "Complete",
};

const SAMPLE_CODEBOOK_DESCRIPTIONS: Record<string, string> = {
  "Sentiment analysis": "Generate a codebook for sentiment analysis: positive, negative, neutral, and mixed sentiments with clear definitions",
  "Thematic coding (interviews)": "Create a thematic codebook for qualitative interview data, identifying recurring themes and patterns",
  "Customer feedback categories": "Build a codebook to categorize customer feedback into actionable categories like complaints, suggestions, praise, and questions",
  "Content classification": "Design a codebook for classifying text content by topic, tone, and intent",
};

interface RawTheme {
  theme: string;
  description: string;
  examples: string[];
}

interface ConsolidatedTheme {
  code: string;
  description: string;
}

interface CodeEntry {
  code: string;
  description: string;
  example: string;
}

function cleanJson(raw: string): string {
  return raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

function cleanCodeName(raw: string): string {
  let s = raw.trim();
  s = s.replace(/_/g, " ");
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (s === s.toUpperCase() && s.length > 1) {
    s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return s;
}

export default function CodebookGeneratorPage() {
  const { markProcessing, markIdle } = useProcessingFlag("/codebook-generator");
  const [data, setData] = useSessionState<Row[]>("codebookgen_data", []);
  const [dataName, setDataName] = useSessionState("codebookgen_dataName", "");
  const [codebookDescription, setCodebookDescription] = useSessionState("codebookgen_description", "");
  const [stage, setStage] = useSessionState<Stage>("codebookgen_stage", "idle");
  const [codebookStructured, setCodebookStructured] = useSessionState<CodeEntry[]>("codebookgen_structured", []);

  // Phase A / B split state
  const [discoveryThemes, setDiscoveryThemes] = useSessionState<RawTheme[]>("codebookgen_themes", []);
  const [discoveryRaw, setDiscoveryRaw] = useSessionState("codebookgen_raw", "");
  const [awaitingReview, setAwaitingReview] = useSessionState("codebookgen_awaitingReview", false);
  const [awaitingReview2, setAwaitingReview2] = useSessionState("codebookgen_awaitingReview2", false);
  const [consolidatedThemes, setConsolidatedThemes] = useSessionState<ConsolidatedTheme[]>("codebookgen_consolidatedThemes", []);
  const [lastRunId, setLastRunId] = useSessionState<string | null>("codebookgen_runId", null);

  const providerConfig = useActiveModel();
  const systemSettings = useSystemSettings();

  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const { selectedCols, toggleCol, toggleAll } = useColumnSelection("codebookgen_selectedCols", allColumns, false);

  // ── Session restore from history ───────────────────────────────────────────
  const restored = useRestoreSession("codebook-generator");
  React.useEffect(() => {
    if (!restored) return;
    setData(restored.data as Row[]);
    setDataName(restored.dataName);
    // Try to restore codebook from results
    const codebook: CodeEntry[] = restored.results
      .filter((r) => r.Code || r.code)
      .map((r) => ({
        code: String(r.Code ?? r.code ?? ""),
        description: String(r.Description ?? r.description ?? ""),
        example: String(r.Example ?? r.example ?? ""),
      }));
    if (codebook.length > 0) {
      setCodebookStructured(codebook);
      setStage("done");
    }
    toast.success(`Restored session from "${restored.dataName}"`);
  }, [restored]);

  // ── Auto-generate AI Instructions ──
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a qualitative researcher generating a codebook from data.");
    lines.push("");

    if (codebookDescription.trim()) {
      lines.push("CODEBOOK DESCRIPTION:");
      lines.push(codebookDescription.trim());
      lines.push("");
    }

    if (selectedCols.length > 0) {
      lines.push("SELECTED COLUMNS:");
      selectedCols.forEach((c) => lines.push(`- ${c}`));
      lines.push("");
    }

    lines.push("RULES:");
    lines.push("- Analyze the data and identify distinct codes/themes");
    lines.push("- For each code provide: code label, description, and representative example");
    lines.push("- Return a JSON array of objects with keys: code, description, example");
    lines.push("- Codes should be mutually exclusive and collectively exhaustive");
    lines.push("- IMPORTANT: Code names MUST be natural human-readable phrases (e.g. \"Emotional Response\", \"Social Support\"), NEVER abbreviations, acronyms, underscores, or codes like \"EMOT_RESP\" or \"SOC_SUPP\"");
    lines.push("- Do not include markdown, code fences, or commentary");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [codebookDescription, selectedCols]);

  // AI Instructions
  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  const handleDataLoaded = (loaded: Row[], name: string) => {
    setData(loaded);
    setDataName(name);
    setCodebookStructured([]);
    setStage("idle");
    setDiscoveryThemes([]);
    setDiscoveryRaw("");
    setAwaitingReview(false);
    setAwaitingReview2(false);
    setConsolidatedThemes([]);
    toast.success(`Loaded ${loaded.length} rows`);
  };

  const handleLoadSample = (key: string) => {
    const ds = SAMPLE_DATASETS[key];
    if (ds) handleDataLoaded(ds.data as Row[], ds.name);
  };

  const callLLM = async (systemPrompt: string, userContent: string): Promise<string> => {
    if (!providerConfig) throw new Error("No enabled provider with API key found");
    const { output } = await dispatchProcessRow({
      provider: providerConfig.providerId,
      model: providerConfig.defaultModel,
      apiKey: providerConfig.apiKey || "",
      baseUrl: providerConfig.baseUrl,
      systemPrompt,
      userContent,
      temperature: systemSettings.temperature || 0.3,
    });
    return output;
  };

  // Phase A: run Stage 1 discovery only, then pause for review
  const generatePhaseA = async () => {
    if (data.length === 0) return toast.error("No data loaded");
    if (!providerConfig) return toast.error("No enabled provider configured. Check Settings.");

    const sampleRows = data.slice(0, 100);

    // Filter to selected columns only
    const filteredRows = selectedCols.length > 0
      ? sampleRows.map((row) => Object.fromEntries(selectedCols.map((c) => [c, row[c]])))
      : sampleRows;

    try {
      setStage("discovery");
      markProcessing();
      const discoveryOutput = await callLLM(
        aiInstructions || getPrompt("codebook.discovery"),
        `Analyze these ${filteredRows.length} data samples:\n\n${JSON.stringify(filteredRows, null, 2)}`
      );

      try {
        const raw = JSON.parse(cleanJson(discoveryOutput)) as Record<string, unknown>[];
        const themes: RawTheme[] = raw.map((r) => ({
          theme: cleanCodeName(String(r.theme ?? r.code ?? r.name ?? "")),
          description: String(r.description ?? r.definition ?? ""),
          examples: Array.isArray(r.examples) ? r.examples as string[]
            : r.example ? [String(r.example)] : [],
        }));
        setDiscoveryThemes(themes);
        setDiscoveryRaw("");
      } catch {
        setDiscoveryThemes([]);
        setDiscoveryRaw(discoveryOutput);
      }

      setStage("idle");
      setAwaitingReview(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Stage 1 failed", { description: msg });
      setStage("idle");
    }
  };

  // Phase B: run Stage 2 (consolidation) only, then pause for Review 2
  const confirmReview1 = async () => {
    if (!providerConfig) return toast.error("No enabled provider configured. Check Settings.");

    setAwaitingReview(false);
    const themesJson = JSON.stringify(discoveryThemes);

    try {
      setStage("consolidation");
      const consolidationOutput = await callLLM(
        getPrompt("codebook.consolidation"),
        `Consolidate these raw themes:\n\n${themesJson}`
      );

      try {
        const parsed = JSON.parse(cleanJson(consolidationOutput)) as Record<string, unknown>[];
        const consolidated: ConsolidatedTheme[] = parsed.map((r) => ({
          code: cleanCodeName(String(r.theme ?? r.code ?? r.name ?? "")),
          description: String(r.description ?? r.definition ?? ""),
        }));
        setConsolidatedThemes(consolidated);
      } catch {
        setConsolidatedThemes([]);
      }

      setStage("idle");
      setAwaitingReview2(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Stage 2 failed", { description: msg });
      setStage("idle");
    }
  };

  // Phase C: run Stage 3 (definition) with (possibly edited) consolidated themes
  const confirmReview2 = async () => {
    if (!providerConfig) return toast.error("No enabled provider configured. Check Settings.");

    setAwaitingReview2(false);

    try {
      setStage("definition");
      const definitionOutput = await callLLM(
        `You are a qualitative researcher creating a formal codebook. Return a JSON array of objects, each with exactly these keys: "code" (short label), "description" (clear definition), "example" (a representative example from the data). Do not include any other keys. Do not include markdown or code fences.`,
        `Create formal definitions for these consolidated themes:\n\n${JSON.stringify(consolidatedThemes)}`
      );

      let structured: CodeEntry[] = [];
      try {
        const parsed = JSON.parse(cleanJson(definitionOutput));
        structured = (parsed as Record<string, unknown>[]).map((e) => ({
          code: cleanCodeName(String(e.code ?? e.theme ?? "")),
          description: String(e.description ?? e.definition ?? ""),
          example: String(e.example ?? (Array.isArray(e.examples) ? (e.examples as string[])[0] ?? "" : "") ?? ""),
        }));
      } catch {
        // Could not parse — leave empty
      }

      setCodebookStructured(structured);
      setStage("done");
      markIdle();
      toast.success("Codebook generated (3 stages complete)!");

      // Save to history DB
      try {
        const runId = await dispatchCreateRun({
          runType: "codebook-generator",
          provider: providerConfig.providerId,
          model: providerConfig.defaultModel,
          temperature: systemSettings.temperature || 0.3,
          systemPrompt: "3-stage codebook pipeline",
          inputFile: dataName || "unnamed",
          inputRows: data.length,
        });
        if (runId) {
          setLastRunId(runId);
          const resultRows = structured.map((entry, i) => ({
            rowIndex: i,
            input: { stage: "codebook" } as Record<string, unknown>,
            output: JSON.stringify(entry),
            status: "success" as const,
            latency: 0,
          }));
          await dispatchSaveResults(runId, resultRows);
        }
      } catch (err) { console.warn("Failed to save codebook to history:", err); }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Codebook generation failed", { description: msg });
      setStage("idle");
      markIdle();
    }
  };

  const goBackToReview1 = () => {
    setAwaitingReview2(false);
    setAwaitingReview(true);
  };

  const restart = () => {
    setAwaitingReview(false);
    setAwaitingReview2(false);
    setDiscoveryThemes([]);
    setDiscoveryRaw("");
    setConsolidatedThemes([]);
    setStage("idle");
  };

  const codebookRows: Row[] = codebookStructured.map((e) => ({
    Code: e.code,
    Description: e.description,
    Example: e.example,
  }));

  const isProcessing = stage !== "idle" && stage !== "done";
  const stageOrder: Stage[] = ["discovery", "consolidation", "definition"];

  return (
    <div className="space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">Codebook Generator</h1>
          <p className="text-muted-foreground text-sm">3-stage AI pipeline: Discovery &rarr; Consolidation &rarr; Definition</p>
        </div>
        {data.length > 0 && (
          <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("codebookgen_"); setData([]); setDataName(""); setCodebookStructured([]); setStage("idle"); setDiscoveryThemes([]); setDiscoveryRaw(""); setAwaitingReview(false); setAwaitingReview2(false); setConsolidatedThemes([]); setLastRunId(null); setCodebookDescription(""); setAiInstructions(""); }}>
            <RotateCcw className="h-3.5 w-3.5" /> Start Over
          </Button>
        )}
      </div>

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
          bannerExtra={
            <span className="text-xs text-green-600 ml-2">(up to 100 rows sampled)</span>
          }
        />
      </div>

      <div className="border-t" />

      {/* ── 2. Describe Codebook ──────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Describe Codebook</h2>
        <PromptEditor
          value={codebookDescription}
          onChange={setCodebookDescription}
          placeholder="Example: Generate a codebook for thematic analysis of interview transcripts about workplace satisfaction..."
          examplePrompts={SAMPLE_CODEBOOK_DESCRIPTIONS}
          label="Instructions"
        />

        <ColumnSelector
          allColumns={allColumns}
          selectedCols={selectedCols}
          onToggleCol={toggleCol}
          onToggleAll={toggleAll}
          description="Choose which columns the AI should analyze to generate the codebook."
        />
      </div>

      <div className="border-t" />

      {/* ── 3. AI Instructions ────────────────────────────────────────────── */}
      <AIInstructionsSection sectionNumber={3} value={aiInstructions} onChange={setAiInstructions} />

      <div className="border-t" />

      {/* ── 4. Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">4. Execute</h2>

        <NoModelWarning activeModel={providerConfig} />

        {!awaitingReview && !awaitingReview2 && (
          <Button size="lg" className="h-12 text-base bg-red-500 hover:bg-red-600 text-white w-full"
            disabled={data.length === 0 || isProcessing || !providerConfig}
            onClick={() => generatePhaseA()}>
            {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Full Run ({Math.min(data.length, 100)} rows)
          </Button>
        )}

        {/* Stage progress tracker */}
        {(stage !== "idle" || awaitingReview || awaitingReview2) && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border">
            {stageOrder.map((s, i) => {
              const currentIdx = stageOrder.indexOf(stage as Stage);
              const completedUpTo = awaitingReview2 ? 1 : awaitingReview ? 0 : -1;
              const isDone = currentIdx > i || stage === "done" || i <= completedUpTo;
              const isActive = stage === s;
              return (
                <React.Fragment key={s}>
                  <div className={`flex items-center gap-2 text-sm ${isDone ? "text-green-600" : isActive ? "text-primary font-medium" : "text-muted-foreground"}`}>
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : isActive ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border-2 border-current" />
                    )}
                    <span className="text-xs capitalize">{i + 1}. {s}</span>
                  </div>
                  {i < 2 && <div className="text-muted-foreground/40 text-sm">→</div>}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {isProcessing && (
          <p className="text-xs text-muted-foreground text-center">{STAGE_LABELS[stage]}</p>
        )}
      </div>

      {/* ── Review Discovered Themes (Phase A result) ────────────────────── */}
      {awaitingReview && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div>
            <h2 className="text-lg font-semibold">Review Discovered Themes</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Stage 1 found {discoveryThemes.length} themes. Add, remove, or rename before consolidation.
            </p>
          </div>

          {discoveryRaw ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-600">Stage 1 output could not be parsed as JSON. Edit manually if needed.</p>
              <pre className="text-xs font-mono bg-muted/20 border rounded p-3 max-h-60 overflow-y-auto whitespace-pre-wrap">{discoveryRaw}</pre>
            </div>
          ) : (
            <div className="space-y-2">
              {discoveryThemes.map((t, idx) => (
                <div key={idx} className="flex items-center gap-2 p-3 border rounded-lg bg-muted/5">
                  <Input
                    value={t.theme}
                    onChange={(e) =>
                      setDiscoveryThemes((prev) =>
                        prev.map((th, i) => i === idx ? { ...th, theme: e.target.value } : th)
                      )
                    }
                    className="h-7 text-sm font-medium w-[30%] shrink-0"
                  />
                  <Input
                    value={t.description}
                    onChange={(e) =>
                      setDiscoveryThemes((prev) =>
                        prev.map((th, i) => i === idx ? { ...th, description: e.target.value } : th)
                      )
                    }
                    className="h-7 text-sm text-muted-foreground flex-1"
                    placeholder="Description"
                  />
                  <button
                    onClick={() => setDiscoveryThemes((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-muted-foreground hover:text-destructive mt-1 shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setDiscoveryThemes((prev) => [...prev, { theme: "", description: "", examples: [] }])}
              >
                <Plus className="h-4 w-4 mr-1.5" /> Add Theme
              </Button>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              size="lg"
              className="h-10 bg-red-500 hover:bg-red-600 text-white"
              onClick={confirmReview1}
              disabled={discoveryThemes.length === 0 && !discoveryRaw}
            >
              {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Confirm &amp; Continue →
            </Button>
            <Button variant="outline" size="lg" className="h-10" onClick={restart}>
              Restart
            </Button>
          </div>
        </div>
      )}

      {/* ── Review Consolidated Codes (after Stage 2) ──────────────────────── */}
      {awaitingReview2 && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div>
            <h2 className="text-lg font-semibold">Review Consolidated Codes</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Stage 2 produced {consolidatedThemes.length} codes. Edit, add, or remove before finalizing the codebook.
            </p>
          </div>

          <div className="space-y-2">
            {consolidatedThemes.map((t, idx) => (
              <div key={idx} className="flex items-center gap-2 p-3 border rounded-lg bg-muted/5">
                  <Input
                    value={t.code}
                    onChange={(e) =>
                      setConsolidatedThemes((prev) =>
                        prev.map((th, i) => i === idx ? { ...th, code: e.target.value } : th)
                      )
                    }
                    className="h-7 text-sm font-medium w-[30%] shrink-0"
                    placeholder="Code name"
                  />
                  <Input
                    value={t.description}
                    onChange={(e) =>
                      setConsolidatedThemes((prev) =>
                        prev.map((th, i) => i === idx ? { ...th, description: e.target.value } : th)
                      )
                    }
                    className="h-7 text-sm text-muted-foreground flex-1"
                    placeholder="Short description"
                  />
                <button
                  onClick={() => setConsolidatedThemes((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-muted-foreground hover:text-destructive mt-1 shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setConsolidatedThemes((prev) => [...prev, { code: "", description: "" }])}
            >
              <Plus className="h-4 w-4 mr-1.5" /> Add Code
            </Button>
          </div>

          <div className="flex gap-3">
            <Button
              size="lg"
              className="h-10 bg-red-500 hover:bg-red-600 text-white"
              onClick={confirmReview2}
              disabled={consolidatedThemes.length === 0}
            >
              {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Confirm &amp; Finalize →
            </Button>
            <Button variant="outline" size="lg" className="h-10" onClick={goBackToReview1}>
              ← Back to Themes
            </Button>
            <Button variant="outline" size="lg" className="h-10" onClick={restart}>
              Restart
            </Button>
          </div>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {codebookRows.length > 0 && (
        <ResultsPanel
          results={codebookRows}
          runId={lastRunId}
          title="Results"
          subtitle={`${codebookRows.length} codes generated`}
        />
      )}
    </div>
  );
}
