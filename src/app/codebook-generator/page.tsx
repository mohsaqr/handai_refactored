"use client";

import React, { useState } from "react";
import { FileUploader } from "@/components/tools/FileUploader";
import { DataTable } from "@/components/tools/DataTable";
import { SampleDatasetPicker } from "@/components/tools/SampleDatasetPicker";
import { Button } from "@/components/ui/button";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { useActiveModel } from "@/lib/hooks";
import { Download, Loader2, CheckCircle2, AlertCircle, Copy } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import type { Row } from "@/types";

type Stage = "idle" | "discovery" | "consolidation" | "definition" | "done";

const STAGE_LABELS: Record<Stage, string> = {
  idle: "Ready",
  discovery: "Stage 1: Discovering themes…",
  consolidation: "Stage 2: Consolidating themes…",
  definition: "Stage 3: Writing definitions…",
  done: "Complete",
};

export default function CodebookGeneratorPage() {
  const [data, setData] = useState<Row[]>([]);
  const [dataName, setDataName] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [codebook, setCodebook] = useState("");
  const [copied, setCopied] = useState(false);
  const [useAllRows, setUseAllRows] = useState(false);

  const providerConfig = useActiveModel();

  const handleDataLoaded = (loaded: Row[], name: string) => {
    setData(loaded);
    setDataName(name);
    setCodebook("");
    setStage("idle");
    toast.success(`Loaded ${loaded.length} rows`);
  };

  const loadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (s) handleDataLoaded(s.data, s.name);
  };

  const callLLM = async (systemPrompt: string, userContent: string): Promise<string> => {
    if (!providerConfig) throw new Error("No enabled provider with API key found");
    const res = await fetch("/api/process-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: providerConfig.providerId,
        model: providerConfig.defaultModel,
        apiKey: providerConfig.apiKey || "local",
        baseUrl: providerConfig.baseUrl,
        systemPrompt,
        userContent,
        temperature: 0.3,
      }),
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    return result.output as string;
  };

  const generateCodebook = async (quickMode: boolean) => {
    if (data.length === 0) return toast.error("No data loaded");
    if (!providerConfig) return toast.error("No enabled provider configured. Check Settings.");

    const sampleRows = quickMode ? data.slice(0, 30) : data.slice(0, 100);

    try {
      // Stage 1: Discovery
      setStage("discovery");
      const discoveryOutput = await callLLM(
        `You are a qualitative researcher performing open coding.
Analyze the provided text samples and identify recurring themes, patterns, and concepts.
Return a JSON array of raw theme objects:
[{"theme": "Theme Name", "description": "brief description", "examples": ["quote1", "quote2"]}]
Return ONLY the JSON array. No other text.`,
        `Analyze these ${sampleRows.length} data samples:\n\n${JSON.stringify(sampleRows, null, 2)}`
      );

      // Stage 2: Consolidation
      setStage("consolidation");
      const consolidationOutput = await callLLM(
        `You are a qualitative researcher performing axial coding.
Review the provided list of raw themes and:
1. Merge overlapping or redundant themes
2. Group related themes into higher-level categories
3. Remove themes that appear very rarely
Return a JSON array of consolidated themes:
[{"theme": "Theme Name", "category": "Category", "merged_from": ["old1"], "description": "..."}]
Return ONLY the JSON array. No other text.`,
        `Consolidate these raw themes:\n\n${discoveryOutput}`
      );

      // Stage 3: Definition
      setStage("definition");
      const definitionOutput = await callLLM(
        `You are a qualitative researcher creating a formal codebook.
For each theme, write a formal code definition with:
- A clear 2-3 sentence definition
- Inclusion criteria (when to apply)
- Exclusion criteria (when NOT to apply)
- 2-3 anchor examples

Format the result as a readable codebook with clear sections for each code.
Use this format for each code:
## [CODE NAME]
**Category:** [category]
**Definition:** [definition]
**Include when:** [inclusion]
**Exclude when:** [exclusion]
**Examples:**
- [example 1]
- [example 2]

Return the full formatted codebook. No JSON.`,
        `Create formal definitions for these consolidated themes:\n\n${consolidationOutput}`
      );

      setCodebook(definitionOutput);
      setStage("done");
      toast.success("Codebook generated (3 stages complete)!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Codebook generation failed", { description: msg });
      setStage("idle");
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(codebook);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied to clipboard");
  };

  const exportMarkdown = () => {
    if (!codebook) return;
    const blob = new Blob([codebook], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `codebook_${dataName || Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isProcessing = stage !== "idle" && stage !== "done";
  const stageOrder: Stage[] = ["discovery", "consolidation", "definition"];

  return (
    <div className="max-w-4xl mx-auto space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1">
        <h1 className="text-4xl font-bold">Codebook Generator</h1>
        <p className="text-muted-foreground text-sm">3-stage AI pipeline: Discovery → Consolidation → Definition</p>
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
              <span>
                <strong>{data.length} rows</strong> loaded from <strong>{dataName}</strong>
                <span className="text-xs text-green-600 ml-2">(Quick: first 30 rows · Full: up to 100 rows)</span>
              </span>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium flex justify-between items-center">
                <span>Data Preview</span>
                <span className="text-xs text-muted-foreground font-normal">first 5 of {data.length} rows</span>
              </div>
              <DataTable data={data} maxRows={5} />
            </div>
          </>
        )}
      </div>

      <div className="border-t" />

      {/* ── 2. Generate ───────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Generate Codebook</h2>

        {/* Stage progress tracker */}
        {stage !== "idle" && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border">
            {stageOrder.map((s, i) => {
              const currentIdx = stageOrder.indexOf(stage as Stage);
              const isDone = currentIdx > i || stage === "done";
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

        {!providerConfig && (
          <Link href="/settings">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 cursor-pointer hover:opacity-90 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No AI model configured — click here to add an API key in Settings
            </div>
          </Link>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Button size="lg" className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
            disabled={data.length === 0 || isProcessing || !providerConfig}
            onClick={() => generateCodebook(true)}>
            {isProcessing && useAllRows === false ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Quick (30 rows)
          </Button>
          <Button variant="outline" size="lg" className="h-12 text-base"
            disabled={data.length === 0 || isProcessing || !providerConfig}
            onClick={() => { setUseAllRows(true); generateCodebook(false); }}>
            {isProcessing && useAllRows ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Full ({Math.min(data.length, 100)} rows)
          </Button>
        </div>

        {isProcessing && (
          <p className="text-xs text-muted-foreground text-center">{STAGE_LABELS[stage]}</p>
        )}
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {codebook && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Generated Codebook</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {codebook.split("\n").length} lines · {(codebook.length / 1000).toFixed(1)}KB
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyToClipboard}>
                {copied ? <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                {copied ? "Copied!" : "Copy"}
              </Button>
              <Button variant="outline" size="sm" onClick={exportMarkdown}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export MD
              </Button>
            </div>
          </div>

          <div className="border rounded-lg bg-muted/5 overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">Codebook — Markdown format</div>
            <div className="p-4 overflow-y-auto max-h-[600px]">
              <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">{codebook}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
