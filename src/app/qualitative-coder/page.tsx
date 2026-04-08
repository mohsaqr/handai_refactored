"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as XLSX from "xlsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { Plus, Trash2, Upload, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { usePersistedPrompt } from "@/hooks/usePersistedPrompt";
import { useColumnSelection } from "@/hooks/useColumnSelection";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useRestoreSession } from "@/hooks/useRestoreSession";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { dispatchProcessRow } from "@/lib/llm-dispatch";
import { useProcessingStore } from "@/lib/processing-store";

import { UploadPreview } from "@/components/tools/UploadPreview";
import { ColumnSelector } from "@/components/tools/ColumnSelector";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { ExecutionPanel } from "@/components/tools/ExecutionPanel";
import { ResultsPanel } from "@/components/tools/ResultsPanel";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";

type Row = Record<string, unknown>;
type CodeEntry = { id: string; code: string; description: string; example: string };

const DEFAULT_PROMPT = `Read the text carefully and apply ALL codes from the codebook that are supported by evidence in the text.

Key principles:
- A single text can receive MULTIPLE codes if it genuinely addresses multiple themes
- Consider both explicit statements and implied meaning
- Only apply a code when the text clearly speaks to that theme — do not stretch to fit
- If genuinely no code applies, return "Uncoded"

Return the applicable codes as a comma-separated list (e.g. "Burnout, Resilience, Work-Life Impact").
Return ONLY the codes. Nothing else.`;

// ─── Sample codebooks ───────────────────────────────────────────────────────
const SAMPLE_CODEBOOKS: Record<string, Omit<CodeEntry, "id">[]> = {
  product_reviews: [
    { code: "Positive", description: "Satisfaction, praise, or happiness with the product", example: "I absolutely love this product! Best purchase ever." },
    { code: "Negative", description: "Dissatisfaction, frustration, or strong criticism", example: "Terrible experience. Would not recommend to anyone." },
    { code: "Neutral / Mixed", description: "Balanced or ambivalent views without strong polarity", example: "It's okay, nothing special but does the job." },
    { code: "Quality Issue", description: "Defects, durability problems, or poor construction", example: "Stitching came undone after first wash." },
    { code: "Shipping / Packaging", description: "Delivery delays, damaged packaging, or wrong items", example: "Arrived damaged. Packaging was inadequate." },
    { code: "Value for Money", description: "Price relative to quality or competing products", example: "Way overpriced for what you get." },
  ],
  healthcare_interviews: [
    { code: "Burnout", description: "Emotional, physical, or mental exhaustion from workload", example: "Burnout is real and it's everywhere." },
    { code: "Resilience", description: "Capacity to find meaning, cope with stress, or persevere", example: "What keeps me going is the patients." },
    { code: "Team Support", description: "Positive collegial relationships and mutual support", example: "Team support makes all the difference." },
    { code: "Resource Shortage", description: "Understaffing, overwork, pay inequity, or inadequate tools", example: "We're chronically underpaid and overworked." },
    { code: "Administrative Burden", description: "Paperwork, bureaucracy, or non-clinical demands", example: "I spend more time on paperwork than with patients." },
    { code: "Work-Life Impact", description: "Effects on personal life, mental health, or relationships", example: "Emotional numbness damages personal relationships." },
  ],
  support_tickets: [
    { code: "Bug Report", description: "Software defects, crashes, or unexpected behavior", example: "App crashes immediately after opening on iOS 17." },
    { code: "Feature Request", description: "Requests for new functionality or improvements", example: "Would love to see a dark mode option in the app." },
    { code: "Billing Issue", description: "Duplicate charges, incorrect invoices, or refund requests", example: "I was charged twice for the same subscription." },
    { code: "Access / Login", description: "Authentication failures, account lockouts, or permissions", example: "I've been trying to login for 3 days." },
    { code: "Performance", description: "Slowness, timeouts, or system degradation", example: "Pages take 30+ seconds to load." },
    { code: "Critical / Blocking", description: "Issues preventing business operations or data loss", example: "This is blocking our monthly reporting." },
  ],
  learning_experience: [
    { code: "Positive Experience", description: "Overall satisfaction with online learning benefits", example: "Online learning has given me flexibility I never had before." },
    { code: "Negative Experience", description: "Frustration or dissatisfaction with the online format", example: "The technical issues are constant." },
    { code: "Technical Issue", description: "Platform crashes, connectivity, or audio/video problems", example: "Poor internet, platform crashes, audio problems." },
    { code: "Social Isolation", description: "Feelings of disconnection, loneliness, or missed networking", example: "I feel isolated. College was supposed to be about making connections." },
    { code: "Engagement", description: "Motivation, participation quality, or peer interaction", example: "I've connected with more diverse perspectives online." },
    { code: "Flexibility", description: "Appreciation for self-paced or asynchronous learning", example: "I can study at my own pace and revisit lectures." },
  ],
  exit_interviews: [
    { code: "Compensation", description: "Salary, benefits, or financial dissatisfaction", example: "I was underpaid compared to market rates." },
    { code: "Career Growth", description: "Lack of advancement opportunities or development", example: "There was no clear path to promotion." },
    { code: "Management", description: "Poor leadership, micromanagement, or communication issues", example: "My manager micromanaged everything." },
    { code: "Work-Life Balance", description: "Excessive hours or difficulty separating work and life", example: "I was expected to be available 24/7." },
    { code: "Culture", description: "Workplace environment, values, or team dynamics", example: "The culture felt toxic and political." },
    { code: "Relocation", description: "Geographic or commute-related reasons for leaving", example: "I'm moving to another city." },
  ],
  mixed_feedback: [
    { code: "Positive", description: "Overall favorable impressions or praise", example: "Really impressive work overall." },
    { code: "Negative", description: "Unfavorable impressions or complaints", example: "Very disappointing outcome." },
    { code: "Neutral", description: "Balanced or uncommitted responses", example: "It was fine, nothing special." },
    { code: "Detailed", description: "Feedback with specific reasoning or examples", example: "The third chapter particularly stood out because..." },
    { code: "Brief", description: "Short responses without elaboration", example: "Good job." },
  ],
};

const SAMPLE_PROMPTS: Record<string, string> = {
  product_reviews: `Analyze this product review and assign all applicable qualitative codes from the codebook.\n\n- Apply every code that is clearly present in the review\n- A review may have multiple codes (e.g. both Positive and Shipping / Packaging)\n- Return ONLY the code labels, comma-separated\n- If no codes apply, return "Uncoded"\n\nRespond with ONLY the comma-separated codes. Nothing else.`,
  healthcare_interviews: `Analyze this healthcare worker interview excerpt and assign qualitative codes.\n\n- Apply all codes from the codebook that are present — responses often contain multiple themes\n- Return ONLY the code labels, comma-separated (e.g. "Burnout, Team Support")\n- If no codes apply, return "Uncoded"\n\nRespond with ONLY the comma-separated codes. Nothing else.`,
  support_tickets: `Classify this customer support ticket using the codebook.\n\n- A ticket may match multiple codes (e.g. a billing issue that is also blocking)\n- Return ONLY the code labels, comma-separated (e.g. "Bug Report, Critical / Blocking")\n- If no codes apply, return "Uncoded"\n\nRespond with ONLY the comma-separated codes. Nothing else.`,
  learning_experience: `Analyze this student response about online learning and assign qualitative codes.\n\n- Apply all codes that are clearly expressed — responses often span multiple themes\n- Return ONLY the code labels, comma-separated (e.g. "Positive Experience, Flexibility")\n- If no codes apply, return "Uncoded"\n\nRespond with ONLY the comma-separated codes. Nothing else.`,
  exit_interviews: `Analyze this employee exit interview response and assign qualitative codes.\n\n- Apply all codes from the codebook that are present in the response\n- Return ONLY the code labels, comma-separated (e.g. "Compensation, Career Growth")\n- If no codes apply, return "Uncoded"\n\nRespond with ONLY the comma-separated codes. Nothing else.`,
  mixed_feedback: `Classify this feedback using the codebook.\n\n- Apply the most fitting codes — a response may be both Positive and Detailed, etc.\n- Return ONLY the code labels, comma-separated\n- If no codes apply, return "Uncoded"\n\nRespond with ONLY the comma-separated codes. Nothing else.`,
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

export default function QualitativeCoderPage() {
  const [data, setData] = useSessionState<Row[]>("qualcoder_data", []);
  const [dataName, setDataName] = useSessionState("qualcoder_dataName", "");
  const [systemPrompt, setSystemPrompt] = usePersistedPrompt("handai_prompt_qualcoder", DEFAULT_PROMPT);
  const [codebook, setCodebook] = useSessionState<CodeEntry[]>("qualcoder_codebook", [
    { id: crypto.randomUUID(), code: "", description: "", example: "" },
    { id: crypto.randomUUID(), code: "", description: "", example: "" },
    { id: crypto.randomUUID(), code: "", description: "", example: "" },
  ]);
  const [, setIsMounted] = useState(false);
  const csvImportRef = useRef<HTMLInputElement>(null);

  const provider = useActiveModel();
  const systemSettings = useSystemSettings();
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const { selectedCols, setSelectedCols, toggleCol, toggleAll } = useColumnSelection("qualcoder_selectedCols", allColumns, false);

  useEffect(() => {
    queueMicrotask(() => setIsMounted(true));
  }, []);

  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a qualitative coding assistant. Apply codes to each row of the dataset.");
    lines.push("");

    if (systemPrompt.trim()) {
      lines.push("CODING INSTRUCTIONS:");
      lines.push(systemPrompt.trim());
      lines.push("");
    }

    if (selectedCols.length > 0) {
      lines.push("SELECTED COLUMNS:");
      selectedCols.forEach((c) => lines.push(`- ${c}`));
      lines.push("");
    }

    const validCodes = codebook.filter((e) => e.code.trim());
    if (validCodes.length > 0) {
      lines.push("CODEBOOK:");
      validCodes.forEach((e, i) =>
        lines.push(`${i + 1}. ${e.code}${e.description ? ` — ${e.description}` : ""}${e.example ? `\n   Example: "${e.example}"` : ""}`)
      );
      lines.push("");
    }

    lines.push("RULES:");
    lines.push("- Apply the most relevant codes from the codebook");
    lines.push("- Return ONLY the code labels, comma-separated");
    lines.push("- If no codes apply, return \"Uncoded\"");
    lines.push("- Do not include any explanation or commentary");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [systemPrompt, selectedCols, codebook]);

  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  const batch = useBatchProcessor({
    toolId: "/qualitative-coder",
    runType: "qualitative-coder",
    activeModel: provider,
    systemSettings,
    data,
    dataName,
    systemPrompt: aiInstructions,
    validate: () => {
      if (!systemPrompt.trim()) return "Enter AI instructions first";
      if (selectedCols.length === 0) return "Select at least one column";
      return null;
    },
    processRow: async (row: Row) => {
      const subset: Row = {};
      selectedCols.forEach((col) => (subset[col] = row[col]));

      const result = await dispatchProcessRow({
        provider: provider!.providerId,
        model: provider!.defaultModel,
        apiKey: provider!.apiKey || "",
        baseUrl: provider!.baseUrl,
        systemPrompt: aiInstructions,
        userContent: JSON.stringify(subset),
        temperature: systemSettings.temperature,
      });

      return { ...row, ai_code: result.output, status: "success", latency_ms: result.latency };
    },
    buildResultEntry: (r: Row, i: number) => ({
      rowIndex: i,
      input: r as Record<string, unknown>,
      output: (r.ai_code as string) ?? "",
      status: (r.status as string) ?? "success",
      latency: r.latency_ms as number | undefined,
      errorMessage: r.error_msg as string | undefined,
    }),
  });

  // ── Session restore from history ───────────────────────────────────────────
  const restored = useRestoreSession("qualitative-coder");
  useEffect(() => {
    if (!restored) return;
    queueMicrotask(() => {
      setData(restored.data);
      setDataName(restored.dataName);

      const fullPrompt = restored.systemPrompt ?? "";

      // Extract coding instructions from saved AI instructions
      const instrMatch = fullPrompt.match(/CODING INSTRUCTIONS:\n([\s\S]*?)(?:\n\n|$)/);
      setSystemPrompt(instrMatch ? instrMatch[1].trim() : fullPrompt);

      // Restore selected columns
      const colsMatch = fullPrompt.match(/SELECTED COLUMNS:\n([\s\S]*?)(?:\n\n|$)/);
      if (colsMatch) {
        const cols = colsMatch[1].split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean);
        if (cols.length > 0) setSelectedCols(cols);
      }

      // Restore codebook from saved AI instructions
      const cbMatch = fullPrompt.match(/CODEBOOK:\n([\s\S]*?)(?:\n\nRULES:|$)/);
      if (cbMatch) {
        const entries: CodeEntry[] = [];
        const cbLines = cbMatch[1].trim().split("\n");
        let currentCode = "";
        let currentDesc = "";
        let currentExample = "";
        for (const line of cbLines) {
          const codeMatch = line.match(/^\d+\.\s+(.+?)(?:\s+—\s+(.*))?$/);
          if (codeMatch) {
            if (currentCode) {
              entries.push({ id: crypto.randomUUID(), code: currentCode, description: currentDesc, example: currentExample });
            }
            currentCode = codeMatch[1].trim();
            currentDesc = codeMatch[2]?.trim() ?? "";
            currentExample = "";
          } else {
            const exMatch = line.match(/^\s+Example:\s+"(.+)"$/);
            if (exMatch) currentExample = exMatch[1];
          }
        }
        if (currentCode) {
          entries.push({ id: crypto.randomUUID(), code: currentCode, description: currentDesc, example: currentExample });
        }
        if (entries.length > 0) setCodebook(entries);
      }

      const errors = restored.results.filter((r) => r.status === "error").length;
      useProcessingStore.getState().completeJob(
        "/qualitative-coder",
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
    setCodebook([{ id: crypto.randomUUID(), code: "", description: "", example: "" }, { id: crypto.randomUUID(), code: "", description: "", example: "" }, { id: crypto.randomUUID(), code: "", description: "", example: "" }]);
    batch.clearResults();
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const handleLoadSample = (key: string) => {
    loadSample(key);
  };

  const loadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (!s) return;
    handleDataLoaded(s.data as Row[], s.name);
    const cb = SAMPLE_CODEBOOKS[key];
    if (cb) {
      setCodebook(cb.map((e) => ({ ...e, id: crypto.randomUUID() })));
    }
    const sp = SAMPLE_PROMPTS[key];
    if (sp) setSystemPrompt(sp);
  };

  const addCode = () =>
    setCodebook((prev) => [...prev, { id: crypto.randomUUID(), code: "", description: "", example: "" }]);

  const updateCode = (id: string, field: keyof CodeEntry, value: string) =>
    setCodebook((prev) => prev.map((e) => e.id === id ? { ...e, [field]: value } : e));

  const deleteCode = (id: string) =>
    setCodebook((prev) => prev.filter((e) => e.id !== id));

  const importCodebook = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const buildEntries = (rows: Record<string, string>[]) => {
      const entries: CodeEntry[] = rows.map((row) => {
        const lowerRow: Record<string, string> = {};
        Object.entries(row).forEach(([k, v]) => { lowerRow[k.trim().toLowerCase()] = String(v ?? "").trim(); });
        if (!lowerRow.code) return null;
        return { id: crypto.randomUUID(), code: lowerRow.code, description: lowerRow.description ?? "", example: lowerRow.example ?? "" };
      }).filter((x): x is CodeEntry => x !== null && x.code.length > 0);
      if (entries.length === 0) { toast.error("No valid codes found (need a 'code' column)"); return; }
      setCodebook(entries);
      toast.success(`Imported ${entries.length} codes`);
    };

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: "array" });
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]]);
        buildEntries(rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) { toast.error("File must have a header row and at least one data row"); return; }
        const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
        const codeIdx = headers.indexOf("code");
        const descIdx = headers.indexOf("description");
        const exIdx = headers.indexOf("example");
        if (codeIdx === -1) { toast.error("File must have a 'code' column"); return; }
        const rows = lines.slice(1).map((line) => {
          const cols = parseCSVLine(line);
          const row: Record<string, string> = {};
          if (codeIdx !== -1) row.code = cols[codeIdx] ?? "";
          if (descIdx !== -1) row.description = cols[descIdx] ?? "";
          if (exIdx !== -1) row.example = cols[exIdx] ?? "";
          return row;
        });
        buildEntries(rows);
      };
      reader.readAsText(file);
    }
    e.target.value = "";
  };

  const exportCodebookCSV = () => {
    if (codebook.length === 0) { toast.error("Codebook is empty"); return; }
    const rows = ["code,description,example", ...codebook.map((e) => [`"${e.code.replace(/"/g, '""')}"`, `"${e.description.replace(/"/g, '""')}"`, `"${e.example.replace(/"/g, '""')}"`].join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "codebook.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-0 pb-16">
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">Qualitative Coder</h1>
          <p className="text-muted-foreground text-sm">AI-assisted qualitative coding — apply codes to each row of your dataset</p>
        </div>
        {data.length > 0 && (
          <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("qualcoder_"); setData([]); setDataName(""); setCodebook([{ id: crypto.randomUUID(), code: "", description: "", example: "" }, { id: crypto.randomUUID(), code: "", description: "", example: "" }, { id: crypto.randomUUID(), code: "", description: "", example: "" }]); setSystemPrompt(""); setAiInstructions(""); batch.clearResults(); }}>
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

      {/* ── 2. Define Columns ─────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Define Columns</h2>
        <ColumnSelector
          allColumns={allColumns}
          selectedCols={selectedCols}
          onToggleCol={toggleCol}
          onToggleAll={toggleAll}
          description="Choose which columns contain the text to be coded."
        />
      </div>

      <div className="border-t" />

      {/* ── 3. Define Codebook ────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold">3. Define Codebook</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Define your codes below. The codebook is automatically included in the AI instructions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={csvImportRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={importCodebook} />
            <Button variant="outline" size="sm" onClick={() => csvImportRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />Import CSV
            </Button>
            <Button variant="outline" size="sm" disabled={codebook.length === 0} onClick={exportCodebookCSV}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />Export CSV
            </Button>
            <Select onValueChange={(key) => {
              const cb = SAMPLE_CODEBOOKS[key];
              if (cb) {
                setCodebook(cb.map((e) => ({ ...e, id: crypto.randomUUID() })));
                toast.success(`Loaded "${key}" sample codebook`);
              }
            }}>
              <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Load an example..." /></SelectTrigger>
              <SelectContent>
                {Object.keys(SAMPLE_CODEBOOKS).map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">{k.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">Codebook</div>
          <div className="p-3 space-y-2">
            {codebook.length === 0 ? (
              <p className="text-center py-8 text-xs text-muted-foreground italic">No codes yet — click &ldquo;Add Code&rdquo; below or import a CSV file.</p>
            ) : (
              codebook.map((entry) => (
                <div key={entry.id} className="flex gap-2 items-center">
                  <Input value={entry.code} onChange={(e) => updateCode(entry.id, "code", e.target.value)} placeholder="Code label" className="flex-[2] h-8 text-xs" />
                  <Input value={entry.description} onChange={(e) => updateCode(entry.id, "description", e.target.value)} placeholder="Description" className="flex-[3] h-8 text-xs" />
                  <Input value={entry.example} onChange={(e) => updateCode(entry.id, "example", e.target.value)} placeholder="Example quote" className="flex-[3] h-8 text-xs" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => deleteCode(entry.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="px-3 pb-3">
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={addCode}>
              <Plus className="h-3 w-3 mr-2" /> Add Code
            </Button>
          </div>
        </div>
      </div>

      <div className="border-t" />

      {/* ── 4. AI Instructions ─────────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={4}
        value={aiInstructions}
        onChange={setAiInstructions}
      >
        <NoModelWarning activeModel={provider} />
      </AIInstructionsSection>

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
          disabled={data.length === 0 || !provider || !systemPrompt.trim() || selectedCols.length === 0}
          onRun={batch.run}
          onAbort={batch.abort}
          onResume={batch.resume}
          onCancel={batch.clearResults}
          failedCount={batch.failedCount}
          skippedCount={batch.skippedCount}
          showSuccessErrors
          successCount={batch.stats?.success ?? 0}
          errorCount={batch.stats?.errors ?? 0}
        />
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      <ResultsPanel
        results={batch.results}
        runId={batch.runId}
        title="Results"
        subtitle={`${batch.results.length} rows coded`}
      />
    </div>
  );
}
