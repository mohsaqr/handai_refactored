"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { UploadPreview } from "@/components/tools/UploadPreview";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useRestoreSession } from "@/hooks/useRestoreSession";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { downloadCSV, downloadXLSX } from "@/lib/export";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { dispatchProcessRow } from "@/lib/llm-dispatch";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Save, FolderOpen, BarChart2, Download, X, Trash2,
  AlertCircle, ChevronDown, ChevronLeft, ChevronRight,
  Highlighter, Loader2, Play,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScreenerAnalyticsPanel } from "./ScreenerAnalyticsDialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

type Decision = "include" | "exclude" | "maybe" | null;

interface AIScreenResult {
  decision: "include" | "exclude" | "maybe";
  confidence: number;
  probabilities: { include: number; maybe: number; exclude: number };
  reasoning: string;
  highlightTerms: string[];
  latency: number;
}

interface ColMap {
  title: string;
  abstract: string;
  keywords: string;
  journal: string;
}

interface WordHighlighter {
  include: string;
  exclude: string;
}

interface ASSession {
  name: string;
  savedAt: string;
  data: Row[];
  aiResults: Record<number, AIScreenResult>;
  decisions: Record<number, Decision>;
  criteria: string;
  colMap: ColMap;
  wordHighlighter: WordHighlighter;
  currentIndex: number;
  dataName: string;
}

interface ASAutosave extends ASSession {
  sessionName: string;
}

interface ASSettings {
  autoAdvance: boolean;
  lightMode: boolean;
  horizontalDecisions: boolean;
  buttonsAboveText: boolean;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const AUTOSAVE_KEY  = "as_autosave";
const AUTOSAVE_PREV = "as_autosave_prev";
const SESSIONS_KEY  = "as_named_sessions";
const SETTINGS_KEY  = "as_settings";

// ─── Default criteria pre-fill ────────────────────────────────────────────────

const DEFAULT_CRITERIA: Record<string, string> = {
  "Systematic Review Abstracts": `Include if:
- Randomised controlled trial (RCT) or systematic review/meta-analysis
- Human adults (≥18 years)
- Depression or anxiety as primary outcome

Exclude if:
- Animal studies
- Non-English language
- Case reports, editorials, or opinion pieces
- Paediatric or adolescent populations only`,
};

// ─── Storage helpers ──────────────────────────────────────────────────────────

function listSessions(): ASSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as ASSession[]).sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );
  } catch { return []; }
}

function upsertSession(s: ASSession) {
  const all = listSessions();
  const i = all.findIndex((x) => x.name === s.name);
  if (i >= 0) all[i] = s; else all.unshift(s);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
}

function deleteStoredSession(name: string) {
  localStorage.setItem(
    SESSIONS_KEY,
    JSON.stringify(listSessions().filter((s) => s.name !== name))
  );
}

function loadSettings(): ASSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const defaults: ASSettings = { autoAdvance: false, lightMode: true, horizontalDecisions: true, buttonsAboveText: false };
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<ASSettings>) } : defaults;
  } catch { return { autoAdvance: false, lightMode: true, horizontalDecisions: true, buttonsAboveText: false }; }
}

function saveSettingsToStorage(s: ASSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function extractJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text) as Record<string, unknown>; } catch { /* fall through */ }
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]) as Record<string, unknown>; } catch { /* fall through */ }
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]) as Record<string, unknown>; } catch { /* fall through */ }
  }
  return null;
}

function parseProbabilities(
  parsed: Record<string, unknown> | null,
  decision: "include" | "exclude" | "maybe"
): { include: number; maybe: number; exclude: number } {
  // Try new probabilities format first
  const probs = parsed?.probabilities as Record<string, number> | undefined;
  if (probs && typeof probs.include === "number" && typeof probs.exclude === "number") {
    return {
      include: Math.max(0, Math.min(1, probs.include)),
      maybe: Math.max(0, Math.min(1, probs.maybe ?? 0)),
      exclude: Math.max(0, Math.min(1, probs.exclude)),
    };
  }
  // Fallback: derive from old single confidence value
  const conf = typeof parsed?.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.8;
  const rest = Math.max(0, 1 - conf);
  if (decision === "include") return { include: conf, maybe: rest * 0.5, exclude: rest * 0.5 };
  if (decision === "exclude") return { include: rest * 0.5, maybe: rest * 0.5, exclude: conf };
  return { include: rest * 0.5, maybe: conf, exclude: rest * 0.5 };
}

function autoDetectColMap(cols: string[]): ColMap {
  const norm = (s: string) => s.toLowerCase().replace(/[_\s-]/g, "");
  const find = (...candidates: string[]) =>
    cols.find((c) => candidates.includes(norm(c))) ?? "";
  return {
    title:    find("title", "ti", "t1", "articletitle"),
    abstract: find("abstract", "ab", "abs", "summary"),
    keywords: find("keywords", "kw", "tags", "keyword"),
    journal:  find("journal", "jo", "jf", "t2", "source", "publication", "venue"),
  };
}

// ─── Multi-group abstract highlighter ────────────────────────────────────────

function highlightAbstract(
  text: string,
  aiTerms: string[],
  includeWords: string[],
  excludeWords: string[]
): React.ReactNode {
  const termMap = new Map<string, string>();

  const push = (terms: string[], cls: string) => {
    for (const t of terms) {
      const clean = t.trim();
      if (clean) termMap.set(clean.toLowerCase(), cls);
    }
  };

  push(includeWords, "bg-green-200 dark:bg-green-900/50 rounded px-0.5");
  push(excludeWords, "bg-red-200 dark:bg-red-900/50 rounded px-0.5");
  push(aiTerms,      "bg-amber-200 dark:bg-amber-800 rounded px-0.5");

  if (!termMap.size) return text;

  const allTerms = [...termMap.keys()].sort((a, b) => b.length - a.length);
  const pattern  = allTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re       = new RegExp(`(${pattern})`, "gi");
  const parts    = text.split(re);

  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const cls = termMap.get(part.toLowerCase());
    return cls ? <mark key={i} className={cls}>{part}</mark> : part;
  });
}

function parseWordList(raw: string): string[] {
  return raw.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AbstractScreenerPage() {
  // ── Core state ─────────────────────────────────────────────────────────────
  const [data, setData]                 = useSessionState<Row[]>("abscreen_data", []);
  const [aiResults, setAiResults]       = useSessionState<Record<number, AIScreenResult>>("abscreen_aiResults", {});
  const [decisions, setDecisions]       = useSessionState<Record<number, Decision>>("abscreen_decisions", {});
  const [includeCriteria, setIncludeCriteria] = useSessionState("abscreen_includeCriteria", "");
  const [excludeCriteria, setExcludeCriteria] = useSessionState("abscreen_excludeCriteria", "");
  const [colMap, setColMap]             = useSessionState<ColMap>("abscreen_colMap", { title: "", abstract: "", keywords: "", journal: "" });
  const [wordHighlighter, setWordHighlighter] = useSessionState<WordHighlighter>("abscreen_wordHighlighter", { include: "", exclude: "" });
  const [currentIndex, setCurrentIndex] = useSessionState("abscreen_currentIndex", 0);
  const [dataName, setDataName]         = useSessionState("abscreen_dataName", "");
  const [sessionName, setSessionName]   = useSessionState("abscreen_sessionName", "");

  const criteria = includeCriteria || excludeCriteria
    ? `Include if:\n${includeCriteria}\n\nExclude if:\n${excludeCriteria}`
    : "";

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const [concurrency, setConcurrency]     = useState(5);
  const [askingAI, setAskingAI]           = useState(false);
  const [showHighlighter, setShowHighlighter] = useState(false);
  const [showAnalytics, setShowAnalytics]   = useState(false);
  const [showTable, setShowTable]           = useState(false);
  const [tablePage, setTablePage]           = useState(0);
  const [tableFilter, setTableFilter]       = useState<"all" | "include" | "exclude" | "maybe" | "undecided">("all");
  const [showSessions, setShowSessions]     = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showAIReasoning, setShowAIReasoning] = useState(false);
  const [sessions, setSessions]             = useState<ASSession[]>([]);
  const [pendingDeleteSession, setPendingDeleteSession] = useState<string | null>(null);
  const [settings, setSettings]             = useState<ASSettings>({ autoAdvance: false, lightMode: true, horizontalDecisions: true, buttonsAboveText: false });
  const [recovered, setRecovered]           = useState<{ count: number; savedAt: string; sessionName: string } | null>(null);
  const [autosaveTime, setAutosaveTime]     = useState<Date | null>(null);
  const [autosaveDisplay, setAutosaveDisplay] = useState("");
  const [pendingLoad, setPendingLoad]       = useState<{ data: Row[]; name: string } | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const stateRef = useRef<ASAutosave>({
    name: "", savedAt: "", data: [], aiResults: {}, decisions: {},
    criteria: "", colMap: { title: "", abstract: "", keywords: "", journal: "" },
    wordHighlighter: { include: "", exclude: "" },
    currentIndex: 0, dataName: "", sessionName: "",
  });

  const activeModel = useActiveModel();
  const systemSettings = useSystemSettings();

  // ── Auto-generate AI Instructions ──────────────────────────────────────────
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are an abstract screener for systematic literature reviews.");
    lines.push("");

    if (criteria.trim()) {
      lines.push("CRITERIA:");
      lines.push(criteria.trim());
      lines.push("");
    }

    const mappedCols = Object.entries(colMap).filter(([, v]) => v);
    if (mappedCols.length > 0) {
      lines.push("COLUMN MAPPING:");
      mappedCols.forEach(([field, col]) => lines.push(`- ${field}: ${col}`));
      lines.push("");
    }

    lines.push("RULES:");
    lines.push("- For each abstract, decide: include, maybe, or exclude");
    lines.push('- Return a JSON object: {"decision": "include"|"maybe"|"exclude", "probabilities": {"include": 0.0, "maybe": 0.0, "exclude": 0.0}, "reasoning": "...", "highlight_terms": ["..."]}');
    lines.push("- probabilities must sum to 1.0 and represent your confidence in each decision");
    lines.push("- Base decisions strictly on the criteria above");
    lines.push("- Do not include markdown or code fences");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [criteria, colMap]);

  // AI Instructions
  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  // ── Batch processor (survives navigation) ──────────────────────────────────
  const batch = useBatchProcessor({
    toolId: "/abstract-screener",
    runType: "abstract-screener",
    activeModel,
    systemSettings,
    data,
    dataName,
    systemPrompt: aiInstructions,
    concurrency,
    validate: () => {
      if (!criteria.trim()) return "Please enter inclusion/exclusion criteria before running AI.";
      if (!colMap.title && !colMap.abstract && !colMap.keywords && !colMap.journal)
        return "Map at least one column (title, abstract, etc.) before running AI.";
      return null;
    },
    processRow: async (row: Row) => {
      const parts = [
        colMap.title    && row[colMap.title]    ? `Title: ${String(row[colMap.title])}` : "",
        colMap.journal  && row[colMap.journal]  ? `Journal: ${String(row[colMap.journal])}` : "",
        colMap.keywords && row[colMap.keywords] ? `Keywords: ${String(row[colMap.keywords])}` : "",
        colMap.abstract && row[colMap.abstract] ? `Abstract: ${String(row[colMap.abstract])}` : "",
      ].filter(Boolean);

      if (parts.length === 0) {
        return { ...row, status: "skipped", latency_ms: 0 };
      }

      const userContent = parts.join("\n\n");
      const start = Date.now();

      const { output } = await dispatchProcessRow({
        provider: activeModel!.providerId,
        model: activeModel!.defaultModel,
        apiKey: activeModel!.apiKey || "",
        baseUrl: activeModel!.baseUrl,
        systemPrompt: aiInstructions,
        userContent,
        temperature: systemSettings.temperature,
      });

      const latency = Date.now() - start;
      const parsed = extractJson(output);
      const decision: "include" | "exclude" | "maybe" =
        parsed?.decision === "include" || parsed?.decision === "exclude" || parsed?.decision === "maybe"
          ? (parsed.decision as "include" | "exclude" | "maybe") : "exclude";
      const probabilities = parseProbabilities(parsed, decision);

      return {
        ...row,
        ai_decision: decision,
        ai_confidence: probabilities[decision],
        ai_probabilities: JSON.stringify(probabilities),
        ai_reasoning: typeof parsed?.reasoning === "string" ? parsed.reasoning : "",
        ai_highlight_terms: JSON.stringify(
          Array.isArray(parsed?.highlight_terms)
            ? (parsed.highlight_terms as unknown[]).filter((t): t is string => typeof t === "string")
            : []
        ),
        status: "success",
        latency_ms: latency,
      };
    },
    buildResultEntry: (r: Row, i: number) => ({
      rowIndex: i,
      input: r as Record<string, unknown>,
      output: JSON.stringify({
        decision: r.ai_decision,
        confidence: r.ai_confidence,
        probabilities: r.ai_probabilities ? JSON.parse(r.ai_probabilities as string) : {},
        reasoning: r.ai_reasoning,
      }),
      status: (r.status as string) ?? "success",
      latency: r.latency_ms as number | undefined,
      errorMessage: r.error_msg as string | undefined,
    }),
    onComplete: (results: Row[]) => {
      const newAiResults: Record<number, AIScreenResult> = {};
      results.forEach((r, i) => {
        if (r.status === "skipped" || r.status === "error") return;
        const decision = r.ai_decision as "include" | "exclude" | "maybe" | undefined;
        if (!decision) return;
        let probabilities: { include: number; maybe: number; exclude: number };
        try {
          probabilities = JSON.parse(r.ai_probabilities as string);
        } catch {
          probabilities = { include: 0, maybe: 0, exclude: 0 };
        }
        let highlightTerms: string[];
        try {
          highlightTerms = JSON.parse(r.ai_highlight_terms as string);
        } catch {
          highlightTerms = [];
        }
        newAiResults[i] = {
          decision,
          confidence: (r.ai_confidence as number) ?? probabilities[decision],
          probabilities,
          reasoning: (r.ai_reasoning as string) ?? "",
          highlightTerms,
          latency: (r.latency_ms as number) ?? 0,
        };
      });
      setAiResults(newAiResults);
    },
  });

  // ── On mount: restore settings + autosave ──────────────────────────────────
  useEffect(() => {
    setSettings(loadSettings());
    setSessions(listSessions());

    let raw: string | null = null;
    try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch { /* ignore */ }
    if (!raw) { try { raw = localStorage.getItem(AUTOSAVE_PREV); } catch { /* ignore */ } }
    if (!raw) return;

    try {
      const s = JSON.parse(raw) as ASAutosave;
      if (!s.data?.length) return;
      setData(s.data);
      setAiResults(s.aiResults || {});
      setDecisions(s.decisions || {});
      const savedCriteria = s.criteria || "";
      const includeMatch = savedCriteria.match(/Include if:\n([\s\S]*?)(?:\n\nExclude if:|$)/);
      const excludeMatch = savedCriteria.match(/Exclude if:\n([\s\S]*?)$/);
      setIncludeCriteria(includeMatch ? includeMatch[1].trim() : savedCriteria);
      setExcludeCriteria(excludeMatch ? excludeMatch[1].trim() : "");
      setColMap(s.colMap || { title: "", abstract: "", keywords: "", journal: "" });
      setWordHighlighter(s.wordHighlighter || { include: "", exclude: "" });
      setCurrentIndex(s.currentIndex || 0);
      setDataName(s.dataName || "");
      setSessionName(s.sessionName || (s.dataName || "").replace(/\.[^.]+$/, ""));
      const cnt = Object.values(s.decisions || {}).filter(Boolean).length;
      setRecovered({ count: cnt, savedAt: s.savedAt || new Date().toISOString(), sessionName: s.sessionName || "" });
    } catch { /* corrupt autosave */ }
  }, []);

  // ── Autosave on state change ─────────────────────────────────────────────
  useEffect(() => {
    if (data.length === 0) return;
    const payload: ASAutosave = {
      name: sessionName, savedAt: new Date().toISOString(),
      data, aiResults, decisions, criteria, colMap, wordHighlighter,
      currentIndex, dataName, sessionName,
    };
    stateRef.current = payload;
    try {
      const existing = localStorage.getItem(AUTOSAVE_KEY);
      if (existing) localStorage.setItem(AUTOSAVE_PREV, existing);
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
      setAutosaveTime(new Date());
    } catch { /* storage full */ }
  }, [data, aiResults, decisions, criteria, includeCriteria, excludeCriteria, colMap, wordHighlighter, currentIndex, dataName, sessionName]);

  // ── Sync stateRef every render ───────────────────────────────────────────
  useEffect(() => {
    if (data.length === 0) return;
    stateRef.current = {
      name: sessionName, savedAt: stateRef.current.savedAt,
      data, aiResults, decisions, criteria, colMap, wordHighlighter,
      currentIndex, dataName, sessionName,
    };
  });

  // ── beforeunload sync write ──────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      const s = stateRef.current;
      if (!s.data.length) return;
      try {
        const payload = { ...s, savedAt: new Date().toISOString() };
        const existing = localStorage.getItem(AUTOSAVE_KEY);
        if (existing) localStorage.setItem(AUTOSAVE_PREV, existing);
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
      } catch { /* ignore */ }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ── Autosave ticker ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!autosaveTime) return;
    setAutosaveDisplay(timeAgo(autosaveTime));
    const id = setInterval(() => setAutosaveDisplay(timeAgo(autosaveTime)), 15_000);
    return () => clearInterval(id);
  }, [autosaveTime]);

  // ── Derived values ───────────────────────────────────────────────────────
  const totalRows       = data.length;
  const currentRow      = data[currentIndex] as Row | undefined;
  const currentAI       = aiResults[currentIndex];
  const currentDecision = decisions[currentIndex] ?? null;
  const allColumns      = data.length > 0 ? Object.keys(data[0]) : [];
  const aiCount         = Object.keys(aiResults).length;

  const decidedEntries  = Object.values(decisions).filter(Boolean);
  const decidedCount    = decidedEntries.length;
  // ── Navigation ───────────────────────────────────────────────────────────
  const navigate = (dir: number) =>
    setCurrentIndex((i) => Math.max(0, Math.min(totalRows - 1, i + dir)));

  const goToNextUndecided = () => {
    for (let i = currentIndex + 1; i < totalRows; i++) {
      if (!decisions[i]) { setCurrentIndex(i); return; }
    }
    for (let i = 0; i < currentIndex; i++) {
      if (!decisions[i]) { setCurrentIndex(i); return; }
    }
    if (currentIndex < totalRows - 1) setCurrentIndex(currentIndex + 1);
  };

  // ── Decision toggling ────────────────────────────────────────────────────
  const setDecision = (d: Decision) => {
    const wasActive = currentDecision === d;
    const next: Decision = wasActive ? null : d;
    setDecisions((prev) => ({ ...prev, [currentIndex]: next }));
    if (!wasActive && settings.autoAdvance) {
      setTimeout(goToNextUndecided, 200);
    }
  };

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    if (data.length === 0 || batch.isProcessing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "l") { e.preventDefault(); navigate(1); }
      if (e.key === "ArrowLeft"  || e.key === "h") { e.preventDefault(); navigate(-1); }
      if (e.key === "y") { e.preventDefault(); setDecision("include"); }
      if (e.key === "n") { e.preventDefault(); setDecision("exclude"); }
      if (e.key === "m") { e.preventDefault(); setDecision("maybe"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.length, batch.isProcessing, currentIndex, decisions, settings.autoAdvance]);

  // ── Data loading ─────────────────────────────────────────────────────────
  const doDataLoaded = (newData: Row[], name: string, autoFillCriteria?: string) => {
    setRecovered(null);
    setData(newData);
    setDataName(name);
    setAiResults({});
    setDecisions({});
    setCurrentIndex(0);
    const sName = name.replace(/\.[^.]+$/, "");
    setSessionName(sName);
    const cols = Object.keys(newData[0] || {});
    setColMap(autoDetectColMap(cols));
    if (autoFillCriteria) {
      const includeMatch = autoFillCriteria.match(/Include if:\n([\s\S]*?)(?:\n\nExclude if:|$)/);
      const excludeMatch = autoFillCriteria.match(/Exclude if:\n([\s\S]*?)$/);
      setIncludeCriteria(includeMatch ? includeMatch[1].trim() : autoFillCriteria);
      setExcludeCriteria(excludeMatch ? excludeMatch[1].trim() : "");
    }
    toast.success(`Loaded ${newData.length} records`);
  };

  // ── Session restore from history ───────────────────────────────────────────
  const restored = useRestoreSession("abstract-screener");
  useEffect(() => {
    if (!restored) return;
    setData(restored.data as Row[]);
    setDataName(restored.dataName);

    const fullPrompt = restored.systemPrompt ?? "";

    // Restore criteria (include/exclude)
    const includeMatch = fullPrompt.match(/Include if:\n([\s\S]*?)(?:\n\nExclude if:|$)/);
    const excludeMatch = fullPrompt.match(/Exclude if:\n([\s\S]*?)(?:\n\n|$)/);
    if (includeMatch) setIncludeCriteria(includeMatch[1].trim());
    if (excludeMatch) setExcludeCriteria(excludeMatch[1].trim());

    // Restore column mapping
    const mapMatch = fullPrompt.match(/COLUMN MAPPING:\n([\s\S]*?)(?:\n\n|$)/);
    if (mapMatch) {
      const newMap: ColMap = { title: "", abstract: "", keywords: "", journal: "" };
      mapMatch[1].split("\n").forEach((l) => {
        const m = l.match(/^- (\w+): (.+)$/);
        if (m) {
          const field = m[1] as keyof ColMap;
          if (field in newMap) newMap[field] = m[2].trim();
        }
      });
      setColMap(newMap);
    }

    toast.success(`Restored session from "${restored.dataName}" (${restored.data.length} rows)`);
  }, [restored]);

  const handleDataLoaded = (newData: Row[], name: string) => {
    if (decidedCount > 0) {
      setPendingLoad({ data: newData, name });
    } else {
      doDataLoaded(newData, name);
    }
  };

  const handleLoadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (!s) return;
    const autoFill = DEFAULT_CRITERIA[s.name];
    if (decidedCount > 0) {
      setPendingLoad({ data: s.data as Row[], name: s.name });
    } else {
      doDataLoaded(s.data as Row[], s.name, autoFill);
    }
  };

  // ── Session management ───────────────────────────────────────────────────
  const updateSettings = (patch: Partial<ASSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettingsToStorage(next);
  };

  const saveSession = (name?: string) => {
    const n = (name || sessionName || dataName || "Session").trim();
    const s: ASSession = {
      name: n, savedAt: new Date().toISOString(),
      data, aiResults, decisions, criteria, colMap, wordHighlighter, currentIndex, dataName,
    };
    upsertSession(s);
    setSessions(listSessions());
    setSessionName(n);
    setShowSaveDialog(false);
    toast.success(`Saved "${n}"`);
  };

  const loadSession = (s: ASSession) => {
    setData(s.data);
    setAiResults(s.aiResults || {});
    setDecisions(s.decisions || {});
    const loadedCriteria = s.criteria || "";
    const lInclude = loadedCriteria.match(/Include if:\n([\s\S]*?)(?:\n\nExclude if:|$)/);
    const lExclude = loadedCriteria.match(/Exclude if:\n([\s\S]*?)$/);
    setIncludeCriteria(lInclude ? lInclude[1].trim() : loadedCriteria);
    setExcludeCriteria(lExclude ? lExclude[1].trim() : "");
    setColMap(s.colMap || { title: "", abstract: "", keywords: "", journal: "" });
    setWordHighlighter(s.wordHighlighter || { include: "", exclude: "" });
    setCurrentIndex(s.currentIndex || 0);
    setDataName(s.dataName || "");
    setSessionName(s.name);
    setShowSessions(false);
    toast.success(`Loaded "${s.name}"`);
  };

  // ── Per-row AI suggestion ──────────────────────────────────────────────────
  const askAI = async () => {
    if (!activeModel || !criteria.trim() || !currentRow) return;
    setAskingAI(true);
    try {
      const parts = [
        colMap.title    && currentRow[colMap.title]    ? `Title: ${String(currentRow[colMap.title])}` : "",
        colMap.journal  && currentRow[colMap.journal]  ? `Journal: ${String(currentRow[colMap.journal])}` : "",
        colMap.keywords && currentRow[colMap.keywords] ? `Keywords: ${String(currentRow[colMap.keywords])}` : "",
        colMap.abstract && currentRow[colMap.abstract] ? `Abstract: ${String(currentRow[colMap.abstract])}` : "",
      ].filter(Boolean);
      if (parts.length === 0) { setAskingAI(false); return; }

      const { output } = await dispatchProcessRow({
        provider: activeModel.providerId, model: activeModel.defaultModel,
        apiKey: activeModel.apiKey || "", baseUrl: activeModel.baseUrl,
        systemPrompt: aiInstructions, userContent: parts.join("\n\n"),
        temperature: systemSettings.temperature,
      });

      const parsed = extractJson(output);
      const decision: "include" | "exclude" | "maybe" =
        parsed?.decision === "include" || parsed?.decision === "exclude" || parsed?.decision === "maybe"
          ? (parsed.decision as "include" | "exclude" | "maybe") : "exclude";
      const probabilities = parseProbabilities(parsed, decision);
      const result: AIScreenResult = {
        decision,
        confidence: probabilities[decision],
        probabilities,
        reasoning: typeof parsed?.reasoning === "string" ? parsed.reasoning : "",
        highlightTerms: Array.isArray(parsed?.highlight_terms)
          ? (parsed.highlight_terms as unknown[]).filter((t): t is string => typeof t === "string")
          : [],
        latency: 0,
      };
      setAiResults((prev) => ({ ...prev, [currentIndex]: result }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("AI suggestion failed", { description: msg });
    }
    setAskingAI(false);
  };

  // ── Export functions ────────────────────────────────────────────────────────

  // ── Human-only export (original data + final_decision) ──
  const buildHumanRows = () => data.map((row, i) => ({
    ...row,
    final_decision: decisions[i] ?? "",
  }));

  const buildHumanDecisionsOnly = () => data.map((row, i) => ({
    title:          colMap.title   ? String(row[colMap.title]   ?? "") : "",
    journal:        colMap.journal ? String(row[colMap.journal] ?? "") : "",
    year:           String(row.year ?? row.Year ?? ""),
    final_decision: decisions[i] ?? "",
  }));

  const exportHumanCsv = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadCSV(buildHumanRows(), `${base}_human_full.csv`);
  };

  const exportHumanDecisions = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadCSV(buildHumanDecisionsOnly(), `${base}_human_decisions.csv`);
  };

  const exportHumanXlsx = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadXLSX(buildHumanRows(), `${base}_human_codes`);
  };

  const exportHumanJson = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    const blob = new Blob([JSON.stringify(buildHumanRows(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${base}_human_codes.json`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── With-AI export (original data + ai columns + final_decision) ──
  const formatProbs = (probs?: { include: number; maybe: number; exclude: number }) => {
    if (!probs) return "";
    return (["include", "maybe", "exclude"] as const)
      .filter((d) => probs[d] > 0)
      .map((d) => `${d.charAt(0).toUpperCase() + d.slice(1)} ${Math.round(probs[d] * 100)}%`)
      .join(", ");
  };

  const buildWithAIRows = () => data.map((row, i) => ({
    ...row,
    ai_decision: aiResults[i]?.decision ?? "",
    ai_probabilities: formatProbs(aiResults[i]?.probabilities),
    ai_reasoning: aiResults[i]?.reasoning ?? "",
    final_decision: decisions[i] ?? "",
  }));

  const buildWithAIDecisionsOnly = () => data.map((row, i) => ({
    title:          colMap.title   ? String(row[colMap.title]   ?? "") : "",
    journal:        colMap.journal ? String(row[colMap.journal] ?? "") : "",
    year:           String(row.year ?? row.Year ?? ""),
    ai_decision: aiResults[i]?.decision ?? "",
    ai_probabilities: formatProbs(aiResults[i]?.probabilities),
    final_decision: decisions[i] ?? "",
  }));

  const exportWithAICsv = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadCSV(buildWithAIRows(), `${base}_with_ai.csv`);
  };

  const exportWithAIDecisions = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadCSV(buildWithAIDecisionsOnly(), `${base}_with_ai_decisions.csv`);
  };

  const exportWithAIXlsx = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadXLSX(buildWithAIRows(), `${base}_with_ai`);
  };

  const exportWithAIJson = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    const blob = new Blob([JSON.stringify(buildWithAIRows(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${base}_with_ai.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const getField = (row: Row | undefined, field: string) =>
    field && row ? String(row[field] ?? "") : "";

  // ── Screening view derived values ──────────────────────────────────────────
  const abstractText = getField(currentRow, colMap.abstract);
  const titleText    = getField(currentRow, colMap.title);
  const journalText  = getField(currentRow, colMap.journal);
  const keywordsText = getField(currentRow, colMap.keywords);
  const yearText     = String(currentRow?.year ?? currentRow?.Year ?? "");

  const aiTerms      = currentAI?.highlightTerms ?? [];
  const includeWords = parseWordList(wordHighlighter.include);
  const excludeWords = parseWordList(wordHighlighter.exclude);

  const keywordPills = keywordsText
    ? keywordsText.split(/[;,]/).map((k) => k.trim()).filter(Boolean)
    : [];

  const tableRows = data
    .map((row, i) => ({
      i,
      title: getField(row, colMap.title) || `Record ${i + 1}`,
      decision: decisions[i] ?? null,
      aiDecision: aiResults[i]?.decision ?? null,
      aiConf: aiResults[i]?.confidence ?? null,
      aiProbs: aiResults[i]?.probabilities ?? null,
    }))
    .filter((r) => {
      if (tableFilter === "all") return true;
      if (tableFilter === "undecided") return !r.decision;
      return r.decision === tableFilter;
    });

  const canRunAI = !!activeModel && !!criteria.trim() && (!!colMap.title || !!colMap.abstract || !!colMap.keywords || !!colMap.journal);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — Single scrollable page with 6 numbered sections
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-0 pb-16">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">Abstract Screener</h1>
          <p className="text-muted-foreground text-sm">
            AI-assisted systematic review screening — batch pre-screen then review
          </p>
        </div>
        {data.length > 0 && (
          <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("abscreen_"); setData([]); setDataName(""); setAiResults({}); setDecisions({}); setIncludeCriteria(""); setExcludeCriteria(""); setCurrentIndex(0); setColMap({ title: "", abstract: "", keywords: "", journal: "" }); setWordHighlighter({ include: "", exclude: "" }); setSessionName(""); setConcurrency(5); setAiInstructions(""); batch.clearResults(); }}>
            <RotateCcw className="h-3.5 w-3.5" /> Start Over
          </Button>
        )}
      </div>

      {/* ── Recovery banner ──────────────────────────────────────────────── */}
      {recovered && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 mb-4">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Session recovered</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                {recovered.sessionName && <><strong>{recovered.sessionName}</strong> · </>}
                {recovered.count} record{recovered.count !== 1 ? "s" : ""} screened
                {" · "}saved {timeAgo(new Date(recovered.savedAt))}
              </p>
            </div>
          </div>
          <button onClick={() => setRecovered(null)}
            className="shrink-0 text-amber-500 hover:text-amber-700 p-0.5" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Session resume ────────────────────────────────────────────────── */}
      {sessions.length > 0 && (
        <Collapsible className="border rounded-xl overflow-hidden mb-4">
          <CollapsibleTrigger className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors">
            <ChevronRight className="h-3.5 w-3.5 transition-transform [[data-state=open]_&]:rotate-90" />
            Resume a Session
            <span className="text-xs text-muted-foreground font-normal ml-auto">{sessions.length} saved</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="p-3 pt-0 space-y-2">
              {sessions.slice(0, 5).map((s) => {
                const decided = Object.values(s.decisions || {}).filter(Boolean).length;
                return (
                  <div key={s.name} className="flex items-center justify-between p-2.5 rounded border hover:bg-muted/30">
                    <div>
                      <div className="text-sm font-medium">{s.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {s.data.length} records · {decided} screened · {new Date(s.savedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => loadSession(s)}>Load</Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDeleteSession(s.name)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Delete session confirmation */}
      <Dialog open={!!pendingDeleteSession} onOpenChange={(open) => { if (!open) setPendingDeleteSession(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete session?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{pendingDeleteSession}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteSession(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (pendingDeleteSession) {
                deleteStoredSession(pendingDeleteSession);
                setSessions(listSessions());
                setPendingDeleteSession(null);
              }
            }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <p className="text-sm text-muted-foreground -mt-2">
          Map your CSV columns to the fields the AI needs. Auto-detected on upload.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {(["title", "abstract", "keywords", "journal"] as const).map((field) => (
            <div key={field} className="space-y-1">
              <Label className="text-xs capitalize">{field}</Label>
              <select
                className="w-full border rounded px-2 py-1.5 text-sm bg-background"
                value={colMap[field]}
                onChange={(e) => setColMap((prev) => ({ ...prev, [field]: e.target.value }))}
              >
                <option value="">(none)</option>
                {allColumns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t" />

      {/* ── 3. Define Criteria ────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Define Criteria</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-green-700 dark:text-green-400 font-medium">Include if</Label>
            <textarea
              value={includeCriteria}
              onChange={(e) => setIncludeCriteria(e.target.value)}
              className={cn(
                "w-full border rounded px-3 py-2 text-sm resize-none h-28 bg-background font-mono transition-colors",
                !includeCriteria.trim() && !excludeCriteria.trim() && "border-amber-400 dark:border-amber-600"
              )}
              placeholder={"- RCT or systematic review\n- Adults (≥18 years)\n- Depression or anxiety as primary outcome"}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-red-700 dark:text-red-400 font-medium">Exclude if</Label>
            <textarea
              value={excludeCriteria}
              onChange={(e) => setExcludeCriteria(e.target.value)}
              className={cn(
                "w-full border rounded px-3 py-2 text-sm resize-none h-28 bg-background font-mono transition-colors",
                !includeCriteria.trim() && !excludeCriteria.trim() && "border-amber-400 dark:border-amber-600"
              )}
              placeholder={"- Animal studies\n- Non-English language\n- Case reports, editorials"}
            />
          </div>
        </div>
        {!criteria.trim() && (
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> Criteria required to run AI
          </p>
        )}

        {/* Word Highlighter (collapsible) */}
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowHighlighter((v) => !v)}
            className="flex items-center gap-2 text-sm w-full px-3 py-2 hover:bg-muted/30 transition-colors"
          >
            {showHighlighter ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Highlighter className="h-3.5 w-3.5 text-muted-foreground" />
            Word Highlighter
            {(wordHighlighter.include || wordHighlighter.exclude) && (
              <span className="ml-auto flex gap-1.5">
                {wordHighlighter.include && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    include: {parseWordList(wordHighlighter.include).length}
                  </span>
                )}
                {wordHighlighter.exclude && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    exclude: {parseWordList(wordHighlighter.exclude).length}
                  </span>
                )}
              </span>
            )}
          </button>
          {showHighlighter && (
            <div className="border-t p-3 bg-muted/5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-green-700 dark:text-green-400">Include keywords</Label>
                  <textarea
                    value={wordHighlighter.include}
                    onChange={(e) => setWordHighlighter((p) => ({ ...p, include: e.target.value }))}
                    className="w-full border border-green-300 dark:border-green-800 rounded px-2 py-1.5 text-xs resize-none h-20 bg-background font-mono"
                    placeholder="RCT, randomised, adults, depression&#10;(comma or one per line)"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-red-700 dark:text-red-400">Exclude keywords</Label>
                  <textarea
                    value={wordHighlighter.exclude}
                    onChange={(e) => setWordHighlighter((p) => ({ ...p, exclude: e.target.value }))}
                    className="w-full border border-red-300 dark:border-red-800 rounded px-2 py-1.5 text-xs resize-none h-20 bg-background font-mono"
                    placeholder="animal, rat, mouse, mice&#10;children, adolescent"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t" />

      {/* ── 4. AI Instructions ────────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={4}
        value={aiInstructions}
        onChange={setAiInstructions}
      >
        <NoModelWarning activeModel={activeModel} />
      </AIInstructionsSection>

      </div>

      <div className="border-t" />

      {/* ── 5. Screen Data ────────────────────────────────────────────────── */}
      <div className="space-y-3 py-8">
        <h2 className="text-2xl font-bold">5. Screen Data</h2>

        {data.length > 0 && (
          <div className="space-y-3">

            {/* ── AI Batch Processing ────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm font-medium">AI Batch Processing</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Concurrency:</span>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setConcurrency((c) => Math.max(1, c - 1))}>−</Button>
                  <span className="text-sm font-mono w-6 text-center">{concurrency}</span>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setConcurrency((c) => Math.min(20, c + 1))}>+</Button>
                </div>
                {activeModel && (
                  <span className="text-xs text-muted-foreground">
                    Model: <span className="text-foreground">{activeModel.defaultModel}</span>
                  </span>
                )}
                {!batch.isProcessing && (
                  <div className="flex items-center gap-2 ml-auto">
                    <Button
                      onClick={() => void batch.run("test")}
                      disabled={!canRunAI || data.length === 0}
                      size="sm"
                      variant="outline"
                    >
                      Test ({Math.min(10, totalRows)} rows)
                    </Button>
                    <Button
                      onClick={() => void batch.run("full")}
                      disabled={!canRunAI || data.length === 0}
                      size="sm"
                      className="bg-red-500 hover:bg-red-600 text-white"
                    >
                      Full Batch ({totalRows} rows)
                    </Button>
                  </div>
                )}
              </div>
              {(() => {
                const incompleteCount = batch.failedCount + batch.skippedCount;
                const isStopped = !batch.isProcessing && incompleteCount > 0;
                const completedOk = batch.progress.total - incompleteCount;
                if (batch.isProcessing || isStopped) return (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground flex-wrap gap-1">
                      <span className="flex items-center gap-1.5">
                        {batch.isProcessing ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {batch.aborting
                              ? "Stopping — waiting for in-flight rows..."
                              : `Processing ${batch.progress.total} rows...`}
                            {!batch.aborting && batch.etaStr && (
                              <span className="text-muted-foreground ml-1">{batch.etaStr}</span>
                            )}
                          </>
                        ) : (
                          <>
                            Stopped — {completedOk} of {batch.progress.total} completed
                            {batch.failedCount > 0 && (
                              <span className="text-red-500 ml-1">({batch.failedCount} errors)</span>
                            )}
                          </>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        {batch.isProcessing && (
                          <span>{batch.progress.completed} / {batch.progress.total}</span>
                        )}
                        {batch.isProcessing && !batch.aborting && (
                          <Button variant="outline" size="sm" onClick={batch.abort}
                            className="h-6 px-2 text-[11px] border-red-300 text-red-600 hover:bg-red-50">
                            Stop
                          </Button>
                        )}
                        {isStopped && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => void batch.resume()}
                              className="h-6 px-2 text-[11px] border-green-300 text-green-700 hover:bg-green-50">
                              <Play className="h-3 w-3 mr-1" />
                              Resume ({incompleteCount} rows)
                            </Button>
                            <Button variant="outline" size="sm" onClick={batch.clearResults}
                              className="h-6 px-2 text-[11px] border-muted-foreground/30 text-muted-foreground hover:bg-muted">
                              <X className="h-3 w-3 mr-1" />
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                      <div
                        className={`${isStopped || batch.aborting ? "bg-amber-400" : "bg-black dark:bg-white"} h-full transition-all duration-300 rounded-full`}
                        style={{ width: `${isStopped && batch.progress.total > 0 ? Math.round((completedOk / batch.progress.total) * 100) : batch.progressPct}%` }}
                      />
                    </div>
                  </div>
                );
                return null;
              })()}
              {!batch.isProcessing && batch.failedCount === 0 && batch.skippedCount === 0 && aiCount > 0 && (
                <p className="text-xs text-green-600">✓ AI suggestions ready for {aiCount}/{totalRows} rows</p>
              )}
            </div>

            {/* ── Settings bar ──────────────────────────────────────────── */}
            <div className="flex items-center gap-5 flex-wrap text-sm border rounded-lg px-4 py-2.5 bg-muted/10">
              <div className="flex items-center gap-2">
                <Switch id="as-light" checked={settings.lightMode} onCheckedChange={(v) => updateSettings({ lightMode: v })} />
                <Label htmlFor="as-light" className="text-xs cursor-pointer">Light mode</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="as-horiz" checked={settings.horizontalDecisions} onCheckedChange={(v) => updateSettings({ horizontalDecisions: v })} />
                <Label htmlFor="as-horiz" className="text-xs cursor-pointer">Horizontal decisions</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="as-above" checked={settings.buttonsAboveText} onCheckedChange={(v) => updateSettings({ buttonsAboveText: v })} />
                <Label htmlFor="as-above" className="text-xs cursor-pointer">Buttons above text</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="as-auto" checked={settings.autoAdvance} onCheckedChange={(v) => updateSettings({ autoAdvance: v })} />
                <Label htmlFor="as-auto" className="text-xs cursor-pointer">Auto-advance</Label>
              </div>
            </div>

            {/* ── Decision buttons (above text if setting on) ──────────── */}
            {settings.buttonsAboveText && (
              <div className={settings.horizontalDecisions ? "flex gap-2" : "space-y-2"}>
                {(
                  [
                    { d: "include" as const, label: "✓ Include", shortcut: "y",
                      active: "bg-green-500 hover:bg-green-600 text-white border-green-500",
                      aiHint: "bg-green-100 border-green-300 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400",
                      inactive: "border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/30" },
                    { d: "maybe" as const, label: "? Maybe", shortcut: "m",
                      active: "bg-amber-500 hover:bg-amber-600 text-white border-amber-500",
                      aiHint: "bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400",
                      inactive: "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30" },
                    { d: "exclude" as const, label: "✗ Exclude", shortcut: "n",
                      active: "bg-red-500 hover:bg-red-600 text-white border-red-500",
                      aiHint: "bg-red-100 border-red-300 text-red-700 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400",
                      inactive: "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30" },
                  ] as const
                ).map(({ d, label, shortcut, active, aiHint, inactive }) => {
                  const isActive = currentDecision === d;
                  const isAISuggested = !isActive && currentAI?.decision === d;
                  const conf = currentAI?.probabilities?.[d] ?? null;
                  return (
                    <button key={d} onClick={() => setDecision(d)}
                      className={cn(
                        "relative border-2 rounded-lg py-3 px-4 text-sm font-medium transition-all flex flex-col items-center gap-0.5 flex-1",
                        isActive ? active : isAISuggested ? aiHint : inactive
                      )}
                    >
                      <span>{label}</span>
                      {conf !== null && conf > 0 && (
                        <span className={cn("text-[10px]", isActive ? "opacity-80" : "opacity-60")}>
                          AI {Math.round(conf * 100)}%
                        </span>
                      )}
                      <span className="absolute bottom-1 right-2 text-[9px] opacity-30">{shortcut}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── Content: Abstract display card ────────────────────────── */}
            <div className={cn(
              "border rounded-xl overflow-hidden w-full",
              settings.lightMode ? "bg-slate-50 dark:bg-slate-900/50" : "bg-slate-900 text-slate-100"
            )}>
              <div className="p-5 space-y-3 break-words">
                {titleText ? (
                  <h2 className="text-xl font-semibold leading-snug">{titleText}</h2>
                ) : (
                  <h2 className="text-xl font-semibold leading-snug text-muted-foreground italic">
                    Record {currentIndex + 1}
                  </h2>
                )}

                {(journalText || yearText) && (
                  <p className={cn("text-sm", settings.lightMode ? "text-muted-foreground" : "text-slate-400")}>
                    {[journalText, yearText].filter(Boolean).join(" · ")}
                  </p>
                )}

                {keywordPills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {keywordPills.map((kw, i) => (
                      <Badge key={i} variant="outline" className="text-xs font-normal">{kw}</Badge>
                    ))}
                  </div>
                )}

                {abstractText ? (
                  <p className="text-sm leading-relaxed">
                    {(aiTerms.length > 0 || includeWords.length > 0 || excludeWords.length > 0)
                      ? highlightAbstract(abstractText, aiTerms, includeWords, excludeWords)
                      : abstractText}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No abstract text available</p>
                )}
              </div>
            </div>

            {/* ── Decision buttons (below text if setting off) ─────────── */}
            {!settings.buttonsAboveText && (
              <div className={settings.horizontalDecisions ? "flex gap-2" : "space-y-2"}>
                {(
                  [
                    { d: "include" as const, label: "✓ Include", shortcut: "y",
                      active: "bg-green-500 hover:bg-green-600 text-white border-green-500",
                      aiHint: "bg-green-100 border-green-300 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400",
                      inactive: "border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/30" },
                    { d: "maybe" as const, label: "? Maybe", shortcut: "m",
                      active: "bg-amber-500 hover:bg-amber-600 text-white border-amber-500",
                      aiHint: "bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400",
                      inactive: "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30" },
                    { d: "exclude" as const, label: "✗ Exclude", shortcut: "n",
                      active: "bg-red-500 hover:bg-red-600 text-white border-red-500",
                      aiHint: "bg-red-100 border-red-300 text-red-700 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400",
                      inactive: "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30" },
                  ] as const
                ).map(({ d, label, shortcut, active, aiHint, inactive }) => {
                  const isActive = currentDecision === d;
                  const isAISuggested = !isActive && currentAI?.decision === d;
                  const conf = currentAI?.probabilities?.[d] ?? null;
                  return (
                    <button key={d} onClick={() => setDecision(d)}
                      className={cn(
                        "relative border-2 rounded-lg py-3 px-4 text-sm font-medium transition-all flex flex-col items-center gap-0.5 flex-1",
                        isActive ? active : isAISuggested ? aiHint : inactive
                      )}
                    >
                      <span>{label}</span>
                      {conf !== null && conf > 0 && (
                        <span className={cn("text-[10px]", isActive ? "opacity-80" : "opacity-60")}>
                          AI {Math.round(conf * 100)}%
                        </span>
                      )}
                      <span className="absolute bottom-1 right-2 text-[9px] opacity-30">{shortcut}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* AI result badge + reasoning */}
            {currentAI && (
              <div className="flex items-start gap-3 px-4 py-3 border rounded-lg">
                <span className={cn(
                  "shrink-0 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide",
                  currentAI.decision === "include"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : currentAI.decision === "maybe"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                )}>
                  AI: {(["include", "maybe", "exclude"] as const)
                    .filter((d) => (currentAI.probabilities?.[d] ?? 0) > 0)
                    .map((d) => `${d.charAt(0).toUpperCase() + d.slice(1)} ${Math.round((currentAI.probabilities?.[d] ?? 0) * 100)}%`)
                    .join(", ")}
                </span>
                <div className="flex-1 min-w-0">
                  <button onClick={() => setShowAIReasoning((v) => !v)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    {showAIReasoning ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {showAIReasoning ? "Hide" : "Show"} reasoning
                  </button>
                  {showAIReasoning && currentAI.reasoning && (
                    <p className="text-xs text-muted-foreground mt-1 italic">{currentAI.reasoning}</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Ask AI (per-row) ─────────────────────────────────────── */}
            {activeModel && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm"
                  className="border-red-400 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400"
                  disabled={askingAI || !canRunAI}
                  onClick={() => void askAI()}>
                  {askingAI ? "Asking AI…" : currentAI ? "Refresh AI" : "Ask AI"}
                </Button>
              </div>
            )}

            {/* ── Next button ──────────────────────────────────────────── */}
            <Button className="w-full h-10 text-base"
              onClick={() => navigate(1)}
              disabled={currentIndex >= totalRows - 1}>
              Next →
            </Button>

            {/* ── Navigation bar (5 elements) ──────────────────────────── */}
            <div className="grid grid-cols-5 gap-1.5 items-center">
              <Button variant="destructive" className="gap-2 px-5" onClick={() => setCurrentIndex(0)}
                disabled={currentIndex === 0}>◀◀</Button>
              <Button variant="destructive" className="gap-2 px-5" onClick={() => navigate(-1)}
                disabled={currentIndex === 0}>◀</Button>
              <div className="text-center text-sm font-medium border rounded px-3 py-1.5">
                {currentIndex + 1} / {totalRows}
              </div>
              <Button variant="destructive" className="gap-2 px-5" onClick={() => navigate(1)}
                disabled={currentIndex >= totalRows - 1}>▶</Button>
              <Button variant="destructive" className="gap-2 px-5" onClick={() => setCurrentIndex(totalRows - 1)}
                disabled={currentIndex >= totalRows - 1}>▶▶</Button>
            </div>
            <div className="text-[10px] text-muted-foreground text-center">
              ← → or h/l navigate &nbsp;·&nbsp; y include &nbsp;·&nbsp; n exclude &nbsp;·&nbsp; m maybe
            </div>

            {/* ── Session bar (below navigation) ──────────────────────── */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-sm">
                <span className="font-medium">Session: </span>
                <code className="text-red-600 dark:text-red-400 text-xs bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded">
                  {sessionName || dataName || "untitled"}
                </code>
                <span className="text-muted-foreground ml-2 text-xs">
                  ({decidedCount}/{totalRows} screened, {aiCount} AI)
                </span>
              </div>
              {autosaveTime && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <span className="text-green-500">✓</span> Autosaved {autosaveDisplay}
                </span>
              )}
              <div className="flex gap-2 ml-auto flex-wrap">
                <Button size="sm" variant="outline" onClick={() => setShowSaveDialog((v) => !v)}>
                  <Save className="h-3.5 w-3.5 mr-1" /> Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowSessions((v) => !v)}>
                  <FolderOpen className="h-3.5 w-3.5 mr-1" /> Load
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowTable((v) => !v)}>
                  Table
                </Button>
              </div>
            </div>

            {/* Save dialog */}
            {showSaveDialog && (
              <div className="flex gap-2 items-center p-3 bg-muted/30 rounded-lg border">
                <Input value={sessionName} onChange={(e) => setSessionName(e.target.value)}
                  placeholder="Session name..." className="h-8 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && saveSession()} autoFocus />
                <Button size="sm" onClick={() => saveSession()}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
              </div>
            )}

            {/* Session browser */}
            {showSessions && (
              <div className="border border-dashed rounded-xl overflow-hidden">
                <div className="px-4 py-2 border-b text-sm font-medium">Saved Sessions</div>
                <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto">
                  {sessions.length > 0 ? sessions.map((s) => {
                    const decided = Object.values(s.decisions || {}).filter(Boolean).length;
                    return (
                      <div key={s.name} className="flex items-center justify-between p-2 rounded hover:bg-muted/30 border">
                        <div>
                          <span className="text-sm font-medium">{s.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">
                            {s.data.length} records · {decided} screened · {new Date(s.savedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => loadSession(s)}>Load</Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setPendingDeleteSession(s.name)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  }) : <p className="text-sm text-muted-foreground p-2">No saved sessions</p>}
                </div>
              </div>
            )}

            {/* ── Progress bar ─────────────────────────────────────────── */}
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div className="bg-red-500 h-full transition-all duration-500"
                style={{ width: `${totalRows > 0 ? (decidedCount / totalRows) * 100 : 0}%` }} />
            </div>

            {/* Table panel */}
            {showTable && (() => {
              const pageSize = 10;
              const totalTablePages = Math.ceil(tableRows.length / pageSize);
              const pageRows = tableRows.slice(tablePage * pageSize, (tablePage + 1) * pageSize);
              return (
                <div className="border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b font-medium text-sm flex items-center gap-2 flex-wrap">
                    <span>Records</span>
                    <div className="flex gap-1 flex-wrap">
                      {(["all", "include", "exclude", "maybe", "undecided"] as const).map((f) => (
                        <button key={f} onClick={() => { setTableFilter(f); setTablePage(0); }}
                          className={cn("px-2 py-0.5 rounded text-xs border",
                            tableFilter === f
                              ? "bg-foreground text-background border-foreground"
                              : "border-muted-foreground/30 text-muted-foreground hover:border-foreground/50"
                          )}>
                          {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                      ))}
                    </div>
                    <span className="ml-auto text-xs text-muted-foreground">{tableRows.length} rows</span>
                  </div>
                  <div className="divide-y">
                    {pageRows.map(({ i, title, decision, aiDecision, aiProbs }) => (
                      <button key={i} onClick={() => { setCurrentIndex(i); setShowTable(false); }}
                        className={cn(
                          "w-full text-left px-4 py-2.5 hover:bg-muted/30 transition-colors flex items-center gap-3",
                          i === currentIndex && "bg-muted/50"
                        )}>
                        <span className="text-xs text-muted-foreground w-8 shrink-0">{i + 1}</span>
                        <span className="text-sm flex-1 truncate">{title}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {aiDecision && aiProbs && (
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded border",
                              aiDecision === "include"
                                ? "border-green-300 text-green-600 dark:border-green-800 dark:text-green-400"
                                : aiDecision === "maybe"
                                ? "border-amber-300 text-amber-600 dark:border-amber-800 dark:text-amber-400"
                                : "border-red-300 text-red-600 dark:border-red-800 dark:text-red-400"
                            )}>
                              {(["include", "maybe", "exclude"] as const)
                                .filter((d) => (aiProbs?.[d] ?? 0) > 0)
                                .map((d) => `${d.charAt(0).toUpperCase() + d.slice(1)} ${Math.round((aiProbs?.[d] ?? 0) * 100)}%`)
                                .join(", ")}
                            </span>
                          )}
                          {decision ? (
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
                              decision === "include" ? "bg-green-500 text-white" :
                              decision === "maybe"   ? "bg-amber-500 text-white" : "bg-red-500 text-white"
                            )}>{decision}</span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  {totalTablePages > 1 && (
                    <div className="px-3 py-2 flex items-center justify-between text-xs text-muted-foreground border-t bg-muted/20">
                      <span>{tableRows.length} rows</span>
                      <div className="flex items-center gap-2">
                        <span>
                          {tablePage * pageSize + 1}&ndash;{Math.min((tablePage + 1) * pageSize, tableRows.length)} of {tableRows.length}
                        </span>
                        <Button variant="outline" size="sm" className="h-6 px-2"
                          onClick={() => setTablePage((p) => Math.max(0, p - 1))} disabled={tablePage === 0}>
                          <ChevronLeft className="h-3 w-3" />
                        </Button>
                        <Button variant="outline" size="sm" className="h-6 px-2"
                          onClick={() => setTablePage((p) => Math.min(totalTablePages - 1, p + 1))} disabled={tablePage >= totalTablePages - 1}>
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

          </div>
        )}
      </div>

      <div className="border-t" />

      {/* ── 6. Export Results ──────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">6. Export Results</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Analytics */}
          <Button variant="destructive" className="gap-2 px-5" onClick={() => setShowAnalytics((v) => !v)}
            disabled={decidedCount === 0 && aiCount === 0}>
            <BarChart2 className="h-3.5 w-3.5 mr-1.5" /> Analytics
          </Button>

          {/* Export Human Codes */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={decidedCount === 0}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export Human Codes <ChevronDown className="h-3 w-3 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={exportHumanCsv}>CSV (full)</DropdownMenuItem>
              <DropdownMenuItem onClick={exportHumanDecisions}>CSV (decisions only)</DropdownMenuItem>
              <DropdownMenuItem onClick={exportHumanXlsx}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={exportHumanJson}>JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Export with AI */}
          {aiCount > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={decidedCount === 0}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export with AI <ChevronDown className="h-3 w-3 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={exportWithAICsv}>CSV (full)</DropdownMenuItem>
                <DropdownMenuItem onClick={exportWithAIDecisions}>CSV (decisions only)</DropdownMenuItem>
                <DropdownMenuItem onClick={exportWithAIXlsx}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onClick={exportWithAIJson}>JSON</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* ── Analytics (inline) ─────────────────────────────────────────────── */}
      {showAnalytics && (
        <ScreenerAnalyticsPanel
          data={data}
          decisions={decisions}
          aiResults={aiResults}
          colMap={colMap}
          onGoToRow={(idx) => { setCurrentIndex(idx); }}
        />
      )}

      {/* ── Pending load dialog ───────────────────────────────────────────── */}
      <Dialog open={!!pendingLoad} onOpenChange={(open) => { if (!open) setPendingLoad(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Replace current session?</DialogTitle>
            <DialogDescription>
              You have{" "}
              <strong>{decidedCount} screened record{decidedCount !== 1 ? "s" : ""}</strong>{" "}
              in the current session. Loading new data will replace all of this.
              Your session has been autosaved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingLoad(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (pendingLoad) doDataLoaded(pendingLoad.data, pendingLoad.name);
              setPendingLoad(null);
            }}>Load anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
