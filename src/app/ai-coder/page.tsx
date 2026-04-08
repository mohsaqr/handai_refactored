"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useRestoreSession } from "@/hooks/useRestoreSession";
import { Plus, Trash2, Upload, Save, FolderOpen, BarChart2, Download, Check, Loader2, X, ChevronDown, ChevronRight, ChevronLeft, RotateCcw, Play } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { usePersistedPrompt } from "@/hooks/usePersistedPrompt";
import { useColumnSelection } from "@/hooks/useColumnSelection";
import { useSessionState, clearSessionKeys } from "@/hooks/useSessionState";
import { dispatchProcessRow } from "@/lib/llm-dispatch";

import { UploadPreview } from "@/components/tools/UploadPreview";
import { ColumnSelector } from "@/components/tools/ColumnSelector";
import { NoModelWarning } from "@/components/tools/NoModelWarning";

import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadCSV as downloadCSVFile, downloadXLSX } from "@/lib/export";
import * as XLSX from "xlsx";
import { AnalyticsPanel } from "./AnalyticsDialog";
import type { CodeEntry } from "./ReviewPanel";

type Row = Record<string, unknown>;

// ─── Color palette for code buttons ─────────────────────────────────────────
const CODE_COLORS = [
  "#f97316", "#8b5cf6", "#06b6d4", "#ec4899",
  "#22c55e", "#eab308", "#3b82f6", "#ef4444",
  "#14b8a6", "#a855f7", "#f59e0b", "#6366f1",
];

function codeColor(code: string, allCodes: string[]): string {
  const idx = allCodes.indexOf(code);
  return CODE_COLORS[idx >= 0 ? idx % CODE_COLORS.length : 0];
}

// ─── Settings type ───────────────────────────────────────────────────────────
interface AICSettings {
  contextRows: number;
  autoAdvance: boolean;
  lightMode: boolean;
  horizontalCodes: boolean;
  buttonsAboveText: boolean;
  autoAcceptThreshold: number;
}

const DEFAULT_SETTINGS: AICSettings = {
  contextRows: 2,
  autoAdvance: false,
  lightMode: true,
  horizontalCodes: true,
  buttonsAboveText: false,
  autoAcceptThreshold: 0.9,
};

// ─── AI suggestion type ─────────────────────────────────────────────────────
interface AISuggestion {
  codes: string[];
  confidence: Record<string, number>;
  reasoning?: string;
}

// ─── Storage keys ────────────────────────────────────────────────────────────
const CODEBOOK_KEY = "handai_codebook_aicoder";
const SESSIONS_KEY = "aic_named_sessions";
const AUTOSAVE_KEY = "aic_autosave";
const SETTINGS_KEY = "aic_settings";

// ─── Default prompt ──────────────────────────────────────────────────────────
const DEFAULT_PROMPT = `Read the text carefully and evaluate EVERY code in the codebook for applicability.

Key principles:
- A single text can express multiple themes — assign high probability to each code the text genuinely speaks to
- Consider both explicit statements and implied/latent meaning
- Multiple codes can have high probabilities simultaneously (they do not need to trade off against each other)

Instructions:
- For EVERY code, estimate the probability (0-100) that it applies to this text
- Probabilities must sum to 100
- A text about burnout AND resilience should give high values to both (e.g. 45, 40) rather than forcing one to dominate

Return ONLY a JSON object mapping each code to its probability.
Example: {"Burnout": 45, "Resilience": 40, "Work-Life Impact": 10, "Other": 5}
Nothing else.`;

// ─── Sample codebooks (with highlights) ──────────────────────────────────────
type SampleCodeEntry = Omit<CodeEntry, "id">;

const SAMPLE_CODEBOOKS: Record<string, SampleCodeEntry[]> = {
  product_reviews: [
    { code: "Positive", description: "Satisfaction, praise, or happiness", highlights: "love,great,excellent,amazing,best" },
    { code: "Negative", description: "Dissatisfaction or criticism", highlights: "terrible,worst,awful,hate,disappointing" },
    { code: "Neutral / Mixed", description: "Balanced or ambivalent views", highlights: "" },
    { code: "Quality Issue", description: "Defects, durability problems, or poor construction", highlights: "broke,defective,cheap,flimsy" },
    { code: "Shipping / Packaging", description: "Delivery delays, damaged packaging", highlights: "shipping,delivery,arrived,package" },
    { code: "Value for Money", description: "Price relative to quality", highlights: "price,expensive,overpriced,worth,cheap" },
  ],
  healthcare_interviews: [
    { code: "Burnout", description: "Emotional, physical, or mental exhaustion", highlights: "exhausted,burned,tired,overwhelmed,drained" },
    { code: "Resilience", description: "Capacity to cope with stress or persevere", highlights: "resilient,cope,strength,adapt,persevere" },
    { code: "Team Support", description: "Positive collegial relationships", highlights: "team,colleagues,support,together" },
    { code: "Resource Shortage", description: "Understaffing, overwork, inadequate tools", highlights: "understaffed,shortage,overworked,underpaid" },
    { code: "Administrative Burden", description: "Paperwork, bureaucracy", highlights: "paperwork,admin,bureaucracy,documentation" },
    { code: "Work-Life Impact", description: "Effects on personal life or relationships", highlights: "family,personal,relationship,sleep" },
  ],
  support_tickets: [
    { code: "Bug Report", description: "Software defects or crashes", highlights: "crash,bug,error,broken,freeze" },
    { code: "Feature Request", description: "New functionality requests", highlights: "would love,wish,feature,add,need" },
    { code: "Billing Issue", description: "Charges, invoices, or refund requests", highlights: "charge,invoice,refund,billing,payment" },
    { code: "Access / Login", description: "Authentication or permissions issues", highlights: "login,password,access,locked,authenticate" },
    { code: "Performance", description: "Slowness or system degradation", highlights: "slow,timeout,loading,performance,lag" },
    { code: "Critical / Blocking", description: "Issues preventing business operations", highlights: "blocking,critical,urgent,emergency,down" },
  ],
  learning_experience: [
    { code: "Positive Experience", description: "Satisfaction with online learning", highlights: "great,enjoy,love,flexible,convenient" },
    { code: "Negative Experience", description: "Frustration with the online format", highlights: "frustrating,difficult,hate,struggle" },
    { code: "Technical Issue", description: "Platform or connectivity problems", highlights: "crash,internet,audio,video,platform" },
    { code: "Social Isolation", description: "Disconnection or loneliness", highlights: "isolated,lonely,miss,disconnect" },
    { code: "Engagement", description: "Motivation and participation quality", highlights: "engaged,motivated,participate,interact" },
    { code: "Flexibility", description: "Self-paced or asynchronous learning", highlights: "pace,flexible,schedule,time,convenient" },
  ],
  exit_interviews: [
    { code: "Compensation", description: "Salary or benefits dissatisfaction", highlights: "salary,pay,compensation,benefits,underpaid" },
    { code: "Career Growth", description: "Lack of advancement opportunities", highlights: "promotion,growth,career,advancement,stagnant" },
    { code: "Management", description: "Poor leadership or communication", highlights: "manager,leadership,micromanage,communication" },
    { code: "Work-Life Balance", description: "Excessive hours or difficulty balancing", highlights: "hours,overtime,balance,weekend,burnout" },
    { code: "Culture", description: "Workplace environment or values", highlights: "culture,toxic,political,environment,values" },
    { code: "Relocation", description: "Geographic reasons for leaving", highlights: "move,relocate,commute,city" },
  ],
  mixed_feedback: [
    { code: "Positive", description: "Favorable impressions or praise", highlights: "great,impressive,excellent,love" },
    { code: "Negative", description: "Unfavorable impressions", highlights: "disappointing,poor,terrible,bad" },
    { code: "Neutral", description: "Balanced or uncommitted", highlights: "" },
    { code: "Detailed", description: "Specific reasoning or examples", highlights: "because,specifically,example,reason" },
    { code: "Brief", description: "Short responses without elaboration", highlights: "" },
  ],
};

const SAMPLE_PROMPTS: Record<string, string> = {
  product_reviews: `Analyze this product review and assign qualitative codes from the codebook.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
  healthcare_interviews: `Analyze this healthcare worker interview excerpt and assign qualitative codes.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
  support_tickets: `Classify this customer support ticket using the codebook.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
  learning_experience: `Analyze this student response about online learning and assign qualitative codes.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
  exit_interviews: `Analyze this employee exit interview response and assign qualitative codes.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
  mixed_feedback: `Classify this feedback using the codebook.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
};

// ─── Session types ───────────────────────────────────────────────────────────
interface AICSession {
  name: string;
  savedAt: string;
  data: Row[];
  codebook: CodeEntry[];
  selectedCols: string[];
  results: Row[];
  overrides: Record<number, string[]>;
  dataName: string;
  systemPrompt: string;
  codingData?: Record<number, string[]>;
  aiData?: Record<number, AISuggestion>;
  currentIndex?: number;
}

// Old session format for migration
interface OldAICSession {
  name: string;
  savedAt: string;
  data: Row[];
  codes?: string[];
  highlights?: Record<string, string>;
  codingData?: Record<number, string[]>;
  aiData?: Record<number, unknown>;
  currentIndex?: number;
  textCols?: string[];
  dataName?: string;
  codebook?: CodeEntry[];
}

function listSessions(): AICSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OldAICSession[];
    return parsed
      .map(migrateSession)
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  } catch { return []; }
}

function migrateSession(s: OldAICSession): AICSession {
  if (s.codebook && Array.isArray(s.codebook)) {
    return s as unknown as AICSession;
  }
  const codes = s.codes ?? [];
  const highlights = s.highlights ?? {};
  const codebook: CodeEntry[] = codes.map((code) => ({
    id: crypto.randomUUID(),
    code,
    description: "",
    highlights: highlights[code] ?? "",
  }));
  return {
    name: s.name,
    savedAt: s.savedAt,
    data: s.data,
    codebook,
    selectedCols: s.textCols ?? [],
    results: [],
    overrides: s.codingData ?? {},
    dataName: s.dataName ?? "",
    systemPrompt: "",
  };
}

function upsertSession(s: AICSession) {
  const all = listSessions();
  const i = all.findIndex((x) => x.name === s.name);
  if (i >= 0) all[i] = s; else all.unshift(s);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
}

function deleteStoredSession(name: string) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(listSessions().filter((s) => s.name !== name)));
}

// ─── CSV parsing ─────────────────────────────────────────────────────────────
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

// ─── Text highlighting ──────────────────────────────────────────────────────
function highlightText(text: string, keywords: string[], color: string): string {
  if (!keywords.length) return text;
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  return text.replace(regex, `<mark style="background:${color}40;border-bottom:2px solid ${color};padding:0 1px;border-radius:2px">$1</mark>`);
}

function applyAllHighlights(text: string, codes: string[], highlightsMap: Record<string, string>): string {
  let result = text;
  codes.forEach((code) => {
    const kwStr = highlightsMap[code];
    if (!kwStr) return;
    const keywords = kwStr.split(",").map((k) => k.trim()).filter(Boolean);
    const color = codeColor(code, codes);
    result = highlightText(result, keywords, color);
  });
  return result;
}

// ─── AI response parser ──────────────────────────────────────────────────────
function parseAIResponse(output: string, codebookCodes?: string[]): { codes: string[]; confidence: Record<string, number>; reasoning?: string } {
  let confidence: Record<string, number> = {};
  let reasoning: string | undefined;
  try {
    const jsonStr = output.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === "object" && parsed !== null) {
      // New format: { codes: { ... }, reasoning: "..." }
      if (parsed.codes && typeof parsed.codes === "object" && !Array.isArray(parsed.codes)) {
        const raw = parsed.codes as Record<string, number>;
        for (const [key, val] of Object.entries(raw)) {
          const cleanKey = key.split(/\s*[—–]\s/)[0].trim();
          if (typeof val === "number") {
            confidence[cleanKey] = (confidence[cleanKey] ?? 0) + val;
          }
        }
        if (typeof parsed.reasoning === "string") {
          reasoning = parsed.reasoning;
        }
      } else {
        // Old flat format: { "Code1": 70, "Code2": 30 }
        const raw = parsed as Record<string, number>;
        for (const [key, val] of Object.entries(raw)) {
          const cleanKey = key.split(/\s*[—–]\s/)[0].trim();
          if (typeof val === "number") {
            confidence[cleanKey] = (confidence[cleanKey] ?? 0) + val;
          }
        }
      }
    }
  } catch {
    // Fallback: comma-separated codes (backward compat)
    const fallback = output.split(",").map((s) => s.trim()).filter((s) => s && s !== "Uncoded");
    fallback.forEach((c) => { confidence[c] = 80; });
  }
  // Filter out codes not in the codebook (case-insensitive match, keep codebook casing)
  if (codebookCodes && codebookCodes.length > 0) {
    const lowerMap = new Map(codebookCodes.map((c) => [c.toLowerCase(), c]));
    const filtered: Record<string, number> = {};
    for (const [key, val] of Object.entries(confidence)) {
      const match = lowerMap.get(key.toLowerCase());
      if (match) {
        filtered[match] = (filtered[match] ?? 0) + val;
      }
    }
    confidence = filtered;
  }
  // Normalize to sum = 100
  const total = Object.values(confidence).reduce((s, v) => s + v, 0);
  if (total > 0) {
    Object.keys(confidence).forEach((k) => { confidence[k] = (confidence[k] / total) * 100; });
  }
  // Codes sorted by probability descending, filter > 0
  const codes = Object.entries(confidence)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k);
  return { codes, confidence, reasoning };
}

// ─── Build export row arrays ─────────────────────────────────────────────────
function buildExportRows(
  data: Row[],
  codes: string[],
  codingData: Record<number, string[]>,
  aiData: Record<number, AISuggestion>,
  mode: "standard" | "onehot" | "onehotAI" | "withAI"
): Record<string, unknown>[] {
  return data.map((row, i) => {
    const humanCodes = codingData[i] ?? [];
    const ai = aiData[i];

    if (mode === "standard") {
      return { ...row, human_codes: humanCodes.join("; ") };
    }
    if (mode === "onehot") {
      const oneHot: Record<string, unknown> = { ...row };
      codes.forEach((c) => { oneHot[c] = humanCodes.includes(c) ? 1 : 0; });
      return oneHot;
    }
    if (mode === "onehotAI") {
      const oneHot: Record<string, unknown> = { ...row };
      codes.forEach((c) => {
        oneHot[`Human_${c}`] = humanCodes.includes(c) ? 1 : 0;
        oneHot[`ai_${c}`] = ai?.confidence?.[c] ? +(ai.confidence[c] / 100).toFixed(4) : 0;
      });
      return oneHot;
    }
    // withAI — compare human codes against only the top AI code
    const aiCodes = ai?.codes ?? [];
    const topAiCode = aiCodes.length > 0 ? aiCodes[0] : "";
    const agree = humanCodes.length > 0 && topAiCode
      ? humanCodes.includes(topAiCode)
      : false;
    return {
      ...row,
      human_codes: humanCodes.join("; "),
      ai_codes: topAiCode,
      ai_probabilities: ai?.confidence
        ? "{" + Object.entries(ai.confidence).sort(([,a],[,b]) => b - a).map(([k,v]) => `${k}(${Math.round(v)}%)`).join(",") + "}"
        : "",
      agreement: String(agree),
    };
  });
}

function exportJSON(rows: Record<string, unknown>[], filename: string) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function AICoderPage() {
  // Data
  const [data, setData] = useSessionState<Row[]>("aicoder_data", []);
  const [dataName, setDataName] = useSessionState("aicoder_dataName", "");

  // Codebook
  const emptyCodebook = (): CodeEntry[] => [
    { id: crypto.randomUUID(), code: "", description: "", highlights: "" },
    { id: crypto.randomUUID(), code: "", description: "", highlights: "" },
    { id: crypto.randomUUID(), code: "", description: "", highlights: "" },
  ];
  const [codebook, setCodebook] = useSessionState<CodeEntry[]>("aicoder_codebook", emptyCodebook());

  // Prompt
  const [systemPrompt, setSystemPrompt] = usePersistedPrompt("handai_prompt_aicoder", DEFAULT_PROMPT);
  // Columns
  const provider = useActiveModel();
  const systemSettings = useSystemSettings();
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const { selectedCols, setSelectedCols, toggleCol, toggleAll } = useColumnSelection("aicoder_selectedCols", allColumns, false);

  // ── Coding state (restored) ──────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useSessionState("aicoder_currentIndex", 0);
  const [codingData, setCodingData] = useSessionState<Record<number, string[]>>("aicoder_codingData", {});
  const [aiData, setAiData] = useSessionState<Record<number, AISuggestion>>("aicoder_aiData", {});
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [settings, setSettings] = useState<AICSettings>(DEFAULT_SETTINGS);

  // Batch processing state
  const [batchConcurrency, setBatchConcurrency] = useState(3);

  // Sessions
  const [sessions, setSessions] = useState<AICSession[]>([]);
  const [pendingDeleteSession, setPendingDeleteSession] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [showAIReasoning, setShowAIReasoning] = useState(false);
  const [tablePage, setTablePage] = useState(0);
  const [sessionName, setSessionName] = useState("");
  const [pendingLoad, setPendingLoad] = useState<{ data: Row[]; name: string } | null>(null);

  // Analytics
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Hydration
  const [isMounted, setIsMounted] = useState(false);
  const csvImportRef = useRef<HTMLInputElement>(null);

  // ── Derived values ─────────────────────────────────────────────────────────
  const codes = codebook.filter((e) => e.code.trim()).map((e) => e.code);
  const highlightsMap = useMemo(() => {
    const map: Record<string, string> = {};
    codebook.forEach((e) => { if (e.highlights) map[e.code] = e.highlights; });
    return map;
  }, [codebook]);
  const totalRows = data.length;
  const appliedCodes = codingData[currentIndex] || [];
  const currentSuggestion = aiData[currentIndex];
  const codedCount = Object.keys(codingData).filter((k) => (codingData[+k] || []).length > 0).length;
  const aiCount = Object.keys(aiData).length;

  // ── Load settings + codebook + sessions from localStorage ────────────────
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CODEBOOK_KEY) || "[]");
      if (Array.isArray(saved) && saved.length > 0) setCodebook(saved);
    } catch {}

    try {
      const savedSettings = localStorage.getItem(SETTINGS_KEY);
      if (savedSettings) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
    } catch {}

    setSessions(listSessions());

    // Check autosave
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.data?.length) {
          setData(s.data);
          setDataName(s.dataName ?? "");
          setSessionName(s.sessionName ?? "");
          if (s.codebook) setCodebook(s.codebook);
          if (s.selectedCols) setSelectedCols(s.selectedCols);
          if (s.codingData) setCodingData(s.codingData);
          if (s.aiData) setAiData(s.aiData);
          if (typeof s.currentIndex === "number") setCurrentIndex(s.currentIndex);
        }
      }
    } catch {}

    setIsMounted(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist codebook
  useEffect(() => {
    if (!isMounted) return;
    localStorage.setItem(CODEBOOK_KEY, JSON.stringify(codebook));
  }, [codebook, isMounted]);

  // ── Settings persistence ────────────────────────────────────────────────
  const updateSettings = useCallback((patch: Partial<AICSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ── Build auto instructions ─────────────────────────────────────────────
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a qualitative coding assistant. Apply codes to each row of the dataset.");
    lines.push("");

    lines.push("INSTRUCTIONS:");
    if (systemPrompt.trim()) {
      lines.push(systemPrompt.trim());
    }
    lines.push("- For EVERY code in the codebook, estimate the probability (0-100) that it applies");
    lines.push('- Return a JSON object with exactly two keys: "codes" and "reasoning"');
    lines.push('- "codes": an object mapping each code label to its probability (e.g. {"Code1": 70, "Code2": 20, "Code3": 10})');
    lines.push('- "reasoning": a single sentence explaining the decisive factor behind the top code');
    lines.push('- Example: {"codes": {"Burnout": 60, "Resilience": 30, "Flexibility": 10}, "reasoning": "The text explicitly describes emotional exhaustion from overwork."}');
    lines.push("- All probabilities inside \"codes\" must sum to 100");
    lines.push("- Use ONLY the exact code labels from the codebook — do NOT add, invent, or rename any codes");
    lines.push("- Every key inside \"codes\" must match a codebook label exactly (case-sensitive)");
    lines.push("- Do NOT put reasoning or any text inside the \"codes\" object — only numeric probabilities");
    lines.push("");

    if (selectedCols.length > 0) {
      lines.push("SELECTED COLUMNS:");
      selectedCols.forEach((c) => lines.push(`- ${c}`));
      lines.push("");
    }

    const validCodes = codebook.filter((e) => e.code.trim());
    if (validCodes.length > 0) {
      lines.push("CODEBOOK:");
      validCodes.forEach((e, i) =>
        lines.push(`${i + 1}. ${e.code}${e.description ? ` — ${e.description}` : ""}`)
      );
      lines.push("");
    }
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [systemPrompt, selectedCols, codebook]);

  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  // ── Session restore from history ───────────────────────────────────────────
  const restored = useRestoreSession("ai-coder");
  useEffect(() => {
    if (!restored) return;
    setData(restored.data);
    setDataName(restored.dataName);
    setSystemPrompt(restored.systemPrompt);
    toast.success(`Restored session from "${restored.dataName}" (${restored.data.length} rows)`);
  }, [restored, setSystemPrompt]);

  // ── Autosave ────────────────────────────────────────────────────────────
  const doAutosave = useCallback(() => {
    if (data.length === 0) return;
    try {
      const payload = {
        data,
        dataName,
        sessionName,
        codebook,
        selectedCols,
        codingData,
        aiData,
        currentIndex,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    } catch {}
  }, [data, dataName, sessionName, codebook, selectedCols, codingData, aiData, currentIndex]);

  useEffect(() => {
    if (!isMounted || data.length === 0) return;
    doAutosave();
  }, [data, codingData, aiData, currentIndex, isMounted]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle code on current row ──────────────────────────────────────────
  const toggleCode = useCallback((code: string) => {
    setCodingData((prev) => {
      const cur = prev[currentIndex] ?? [];
      const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
      return { ...prev, [currentIndex]: next };
    });
    if (settings.autoAdvance) {
      setTimeout(() => {
        setCurrentIndex((i) => Math.min(totalRows - 1, i + 1));
      }, 150);
    }
  }, [currentIndex, settings.autoAdvance, totalRows]);

  // ── Navigation ──────────────────────────────────────────────────────────
  const navigate = useCallback((dir: number) => {
    setCurrentIndex((i) => Math.max(0, Math.min(totalRows - 1, i + dir)));
  }, [totalRows]);

  // ── Get AI suggestion for single row ────────────────────────────────────
  const getAiSuggestion = useCallback(async (rowIdx?: number) => {
    const idx = rowIdx ?? currentIndex;
    if (!provider) { toast.error("No model configured. Go to Settings."); return; }
    if (codes.length === 0) { toast.error("Define at least one code first"); return; }

    setIsAiLoading(true);
    try {
      const row = data[idx];
      const subset: Row = {};
      if (selectedCols.length > 0) {
        selectedCols.forEach((col) => (subset[col] = row[col]));
      } else {
        Object.assign(subset, row);
      }

      const result = await dispatchProcessRow({
        provider: provider.providerId,
        model: provider.defaultModel,
        apiKey: provider.apiKey || "",
        baseUrl: provider.baseUrl,
        systemPrompt: aiInstructions,
        userContent: JSON.stringify(subset),
        temperature: systemSettings.temperature,
      });

      const output = result.output.trim();
      const { codes: parsedCodes, confidence, reasoning } = parseAIResponse(output, codes);

      const suggestion: AISuggestion = { codes: parsedCodes, confidence, reasoning };
      setAiData((prev) => ({ ...prev, [idx]: suggestion }));
    } catch (err) {
      toast.error(`AI error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAiLoading(false);
    }
  }, [currentIndex, provider, codes, data, selectedCols, aiInstructions, systemSettings.temperature]);

  // ── Batch AI processing (via useBatchProcessor) ────────────────────────
  const batch = useBatchProcessor({
    toolId: "/ai-coder",
    runType: "ai-coder",
    activeModel: provider,
    systemSettings,
    data,
    dataName,
    systemPrompt: aiInstructions,
    concurrency: batchConcurrency,
    selectData: (_data: Record<string, unknown>[], mode: string) =>
      mode === "preview" ? _data.slice(0, 3) : mode === "test" ? _data.slice(0, 20) : _data,
    validate: () => {
      if (codes.length === 0) return "Define at least one code";
      return null;
    },
    processRow: async (row: Row) => {
      const subset: Row = {};
      if (selectedCols.length > 0) {
        selectedCols.forEach((col) => (subset[col] = row[col]));
      } else {
        Object.assign(subset, row);
      }

      const result = await dispatchProcessRow({
        provider: provider!.providerId,
        model: provider!.defaultModel,
        apiKey: provider!.apiKey || "",
        baseUrl: provider!.baseUrl,
        systemPrompt: aiInstructions,
        userContent: JSON.stringify(subset),
        temperature: systemSettings.temperature,
      });

      const output = result.output.trim();
      return { ...row, ai_codes: output, status: "success", latency_ms: result.latency };
    },
    buildResultEntry: (r: Row, i: number) => ({
      rowIndex: i,
      input: r as Record<string, unknown>,
      output: (r.ai_codes as string) ?? "",
      status: (r.status as string) ?? "success",
      latency: r.latency_ms as number | undefined,
      errorMessage: r.error_msg as string | undefined,
    }),
    onComplete: (results: Row[]) => {
      const newAiData: Record<number, AISuggestion> = {};
      results.forEach((r, idx) => {
        if (r.status === "success" && r.ai_codes) {
          const { codes: parsedCodes, confidence, reasoning } = parseAIResponse(String(r.ai_codes), codes);
          newAiData[idx] = { codes: parsedCodes, confidence, reasoning };
        }
      });
      const scrollY = window.scrollY;
      setAiData((prev) => ({ ...prev, ...newAiData }));
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
      doAutosave();
    },
  });

  // ── Get row HTML with highlighting ──────────────────────────────────────
  const getRowHtml = useCallback((row: Row, _rowIdx: number, isCurrent: boolean) => {
    const cols = selectedCols.length > 0 ? selectedCols : Object.keys(row);
    const parts = cols.map((col) => {
      const val = String(row[col] ?? "");
      if (isCurrent) {
        return applyAllHighlights(val, codes, highlightsMap);
      }
      return val.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    });
    return parts.join(" — ");
  }, [selectedCols, codes, highlightsMap]);

  // ── Keyboard handler ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowRight" || e.key === "l") { e.preventDefault(); navigate(1); }
      else if (e.key === "ArrowLeft" || e.key === "h") { e.preventDefault(); navigate(-1); }
      else {
        const n = parseInt(e.key);
        if (!isNaN(n) && n >= 1 && n <= codes.length) {
          e.preventDefault();
          toggleCode(codes[n - 1]);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, toggleCode, codes]);

  // ── Data loading ────────────────────────────────────────────────────────
  const doDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    setCurrentIndex(0);
    setCodebook(emptyCodebook());
    setCodingData({});
    setAiData({});
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const handleDataLoaded = (newData: Row[], name: string) => {
    if (codedCount > 0) {
      setPendingLoad({ data: newData, name });
    } else {
      doDataLoaded(newData, name);
    }
  };

  const loadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (!s) return;
    if (codedCount > 0) {
      setPendingLoad({ data: s.data as Row[], name: s.name });
      return;
    }
    doDataLoaded(s.data as Row[], s.name);
    const cb = SAMPLE_CODEBOOKS[key];
    if (cb) {
      setCodebook(cb.map((e) => ({ ...e, id: crypto.randomUUID() })));
    }
    const sp = SAMPLE_PROMPTS[key];
    if (sp) setSystemPrompt(sp);
  };

  // ── Codebook management ─────────────────────────────────────────────────
  const addCode = () =>
    setCodebook((prev) => [...prev, { id: crypto.randomUUID(), code: "", description: "", highlights: "" }]);

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
        return {
          id: crypto.randomUUID(),
          code: lowerRow.code,
          description: lowerRow.description ?? "",
          highlights: lowerRow.highlights ?? "",
        };
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
        const hlIdx = headers.indexOf("highlights");
        if (codeIdx === -1) { toast.error("File must have a 'code' column"); return; }
        const rows = lines.slice(1).map((line) => {
          const cols = parseCSVLine(line);
          const row: Record<string, string> = {};
          if (codeIdx !== -1) row.code = cols[codeIdx] ?? "";
          if (descIdx !== -1) row.description = cols[descIdx] ?? "";
          if (hlIdx !== -1) row.highlights = cols[hlIdx] ?? "";
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
    const rows = [
      "code,description,highlights",
      ...codebook.map((e) =>
        [`"${e.code.replace(/"/g, '""')}"`, `"${e.description.replace(/"/g, '""')}"`, `"${e.highlights.replace(/"/g, '""')}"`].join(",")
      ),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "codebook.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Sessions ────────────────────────────────────────────────────────────
  const saveSession = (name?: string) => {
    const n = (name || sessionName || dataName || "Session").trim();
    const s: AICSession = {
      name: n,
      savedAt: new Date().toISOString(),
      data,
      codebook,
      selectedCols,
      results: [],
      overrides: {},
      dataName,
      systemPrompt,
      codingData,
      aiData,
      currentIndex,
    };
    upsertSession(s);
    setSessions(listSessions());
    setSessionName(n);
    setShowSaveDialog(false);
    toast.success(`Saved "${n}"`);
  };

  const loadSession = (s: AICSession) => {
    setData(s.data);
    setCodebook(s.codebook);
    if (s.selectedCols?.length) setSelectedCols(s.selectedCols);
    if (s.systemPrompt) setSystemPrompt(s.systemPrompt);
    setDataName(s.dataName ?? "");
    setSessionName(s.name);
    setCodingData(s.codingData ?? s.overrides ?? {});
    setAiData(s.aiData ?? {});
    setCurrentIndex(s.currentIndex ?? 0);
    setShowSessions(false);
    toast.success(`Loaded "${s.name}"`);
  };

  // ── Theme colors ────────────────────────────────────────────────────────
  const lightBg = settings.lightMode ? "#FFFEF5" : "#1a1a2e";
  const lightText = settings.lightMode ? "#1a1a1a" : "#eee";
  const ctxBg = settings.lightMode ? "#F8F9FA" : "rgba(128,128,128,0.15)";
  const ctxText = settings.lightMode ? "#555" : "#bbb";

  // ── Batch progress percentage ───────────────────────────────────────────

  // ── Render ──────────────────────────────────────────────────────────────
  if (!isMounted) return null;

  return (
    <div className="space-y-0 pb-16">
      <div className="pb-4 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">AI Coder</h1>
          <p className="text-muted-foreground text-sm">AI-assisted qualitative coding with review &amp; analytics</p>
        </div>
        {data.length > 0 && (
          <Button variant="destructive" className="gap-2 px-5" onClick={() => { clearSessionKeys("aicoder_"); setData([]); setDataName(""); setCodebook(emptyCodebook()); setCodingData({}); setAiData({}); setCurrentIndex(0); setSystemPrompt(""); setSessionName(""); setAiInstructions(""); batch.clearResults(); }}>
            <RotateCcw className="h-3.5 w-3.5" /> Start Over
          </Button>
        )}
      </div>

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
                const coded = Object.values(s.codingData || {}).filter((c) => c.length > 0).length;
                return (
                  <div key={s.name} className="flex items-center justify-between p-2.5 rounded border hover:bg-muted/30">
                    <div>
                      <div className="text-sm font-medium">{s.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {s.data.length} rows · {coded} coded · {new Date(s.savedAt).toLocaleDateString()}
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
            <Select onValueChange={loadSample}>
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

      {/* ── 3. Define Codes with Highlights ───────────────────────────────── */}
      <div className="space-y-4 py-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold">3. Define Codes</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Define your codes below. Highlight keywords are optional — used for visual emphasis during review.
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
                  <Input value={entry.highlights} onChange={(e) => updateCode(entry.id, "highlights", e.target.value)} placeholder="word1, word2, phrase…" className="flex-[3] h-8 text-xs" />
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

      {/* ── 5. Code Data ───────────────────────────────────────────────────── */}
      <div className="space-y-2 py-8">
        <h2 className="text-2xl font-bold">5. Code Data</h2>

        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Upload data and define codes to start coding.</p>
        ) : codes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Define at least one code in Section 3 to begin.</p>
        ) : (
          <>
            {/* ── Batch Processing ─────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm font-medium">AI Batch Processing</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Concurrency:</span>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setBatchConcurrency((c) => Math.max(1, c - 1))}>−</Button>
                  <span className="text-sm font-mono w-6 text-center">{batchConcurrency}</span>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setBatchConcurrency((c) => Math.min(20, c + 1))}>+</Button>
                </div>
                {provider && (
                  <span className="text-xs text-muted-foreground">
                    Model: <span className="text-foreground">{provider.defaultModel}</span>
                  </span>
                )}
                {!batch.isProcessing && (
                  <div className="flex items-center gap-2 ml-auto">
                    <Button
                      onClick={() => batch.run("test")}
                      disabled={!provider || batch.isProcessing}
                      size="sm"
                      variant="outline"
                    >
                      Test ({Math.min(10, data.length)} rows)
                    </Button>
                    <Button
                      onClick={() => batch.run("full")}
                      disabled={!provider || batch.isProcessing}
                      size="sm"
                      className="bg-red-500 hover:bg-red-600 text-white"
                    >
                      Full Batch ({data.length} rows)
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
                            <Button variant="outline" size="sm" onClick={() => batch.resume()}
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
                        className={`${isStopped || batch.aborting ? "bg-amber-400" : "bg-black dark:bg-white"} h-full transition-all duration-300`}
                        style={{ width: `${isStopped && batch.progress.total > 0 ? Math.round((completedOk / batch.progress.total) * 100) : batch.progressPct}%` }}
                      />
                    </div>
                  </div>
                );
                return null;
              })()}
              {!batch.isProcessing && batch.failedCount === 0 && batch.skippedCount === 0 && aiCount > 0 && (
                <p className="text-xs text-green-600">
                  AI suggestions ready for {aiCount}/{data.length} rows
                </p>
              )}
            </div>

            {/* ── Settings toggles row ──────────────────────────────────── */}
            <div className="flex items-center gap-5 flex-wrap text-sm border rounded-lg px-4 py-2.5 bg-muted/10 !mt-4">
              <div className="flex items-center gap-2">
                <Switch id="aic-light" checked={settings.lightMode} onCheckedChange={(v) => updateSettings({ lightMode: v })} />
                <Label htmlFor="aic-light" className="text-xs cursor-pointer">Light mode</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="aic-horiz" checked={settings.horizontalCodes} onCheckedChange={(v) => updateSettings({ horizontalCodes: v })} />
                <Label htmlFor="aic-horiz" className="text-xs cursor-pointer">Horizontal codes</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="aic-above" checked={settings.buttonsAboveText} onCheckedChange={(v) => updateSettings({ buttonsAboveText: v })} />
                <Label htmlFor="aic-above" className="text-xs cursor-pointer">Buttons above text</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="aic-auto" checked={settings.autoAdvance} onCheckedChange={(v) => updateSettings({ autoAdvance: v })} />
                <Label htmlFor="aic-auto" className="text-xs cursor-pointer">Auto-advance</Label>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <Label className="text-xs cursor-pointer">Context</Label>
                <Button size="sm" variant="outline" className="h-6 w-6 p-0 text-xs" onClick={() => updateSettings({ contextRows: Math.max(0, settings.contextRows - 1) })}>−</Button>
                <span className="text-xs font-mono w-4 text-center">{settings.contextRows}</span>
                <Button size="sm" variant="outline" className="h-6 w-6 p-0 text-xs" onClick={() => updateSettings({ contextRows: Math.min(10, settings.contextRows + 1) })}>+</Button>
              </div>
            </div>

            {/* ── Text + Codes core (tight, no gap) ─────────────────────── */}
            <div className="space-y-0 !mt-4">
              {/* Code buttons above text */}
              {settings.buttonsAboveText && (
                <div className="mb-1">
                  <CodeButtonsPanel
                    codes={codes}
                    appliedCodes={appliedCodes}
                    currentSuggestion={currentSuggestion}
                    horizontal={settings.horizontalCodes}
                    onToggle={toggleCode}
                  />
                </div>
              )}

              {/* Text display with context rows */}
              <div className="rounded-lg border overflow-hidden">
                {(() => {
                  const contextRange: number[] = [];
                  for (let i = Math.max(0, currentIndex - settings.contextRows); i <= Math.min(totalRows - 1, currentIndex + settings.contextRows); i++) {
                    contextRange.push(i);
                  }
                  return contextRange.map((rowIdx) => {
                    const isCurrent = rowIdx === currentIndex;
                    const row = data[rowIdx];
                    if (!row) return null;
                    return (
                      <div
                        key={rowIdx}
                        className="px-4 py-2"
                        style={isCurrent
                          ? { backgroundColor: lightBg, color: lightText, borderLeft: "4px solid #4CAF50", fontSize: "1.05em" }
                          : { backgroundColor: ctxBg, color: ctxText, borderLeft: "4px solid transparent", fontSize: "0.93em", opacity: 0.85 }}
                        dangerouslySetInnerHTML={{ __html: getRowHtml(row, rowIdx, isCurrent) }}
                      />
                    );
                  });
                })()}
              </div>

              {/* Code buttons below text */}
              {!settings.buttonsAboveText && (
                <div className="mt-1">
                  <CodeButtonsPanel
                    codes={codes}
                    appliedCodes={appliedCodes}
                    currentSuggestion={currentSuggestion}
                    horizontal={settings.horizontalCodes}
                    onToggle={toggleCode}
                  />
                </div>
              )}
            </div>

            {/* AI result badge + reasoning */}
            {currentSuggestion && currentSuggestion.codes.length > 0 && (
              <div className="flex items-start gap-3 px-4 py-3 border rounded-lg">
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  <span className="text-xs font-medium text-muted-foreground">AI:</span>
                  {currentSuggestion.codes.map((c) => {
                    const conf = currentSuggestion.confidence?.[c];
                    return (
                      <span key={c} className="text-xs font-medium px-2 py-0.5 rounded"
                        style={{ backgroundColor: codeColor(c, codes), color: "#1a1a1a" }}>
                        {c}{conf != null ? ` ${Math.round(conf)}%` : ""}
                      </span>
                    );
                  })}
                </div>
                <div className="flex-1 min-w-0">
                  <button onClick={() => setShowAIReasoning((v) => !v)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    {showAIReasoning ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {showAIReasoning ? "Hide" : "Show"} reasoning
                  </button>
                  {showAIReasoning && currentSuggestion.reasoning && (
                    <p className="text-xs text-muted-foreground mt-1 italic">{currentSuggestion.reasoning}</p>
                  )}
                </div>
              </div>
            )}

            {/* ── AI action bar ───────────────────────────────────────────── */}
            <div className="flex items-center gap-2 flex-wrap !mt-4">
              {provider ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void getAiSuggestion()}
                  disabled={isAiLoading}
                  className="border-red-400 text-red-600 hover:bg-red-50"
                >
                  {isAiLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  {currentSuggestion ? "Refresh AI" : "Ask AI"}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  <a href="/settings" className="text-orange-500 underline">Configure model</a> for AI suggestions
                </span>
              )}
            </div>

            {/* ── Big Next button ──────────────────────────────────────────── */}
            <Button className="w-full h-10 text-base" disabled={currentIndex >= totalRows - 1} onClick={() => navigate(1)}>
              Next ▶
            </Button>

            {/* ── Navigation bar (5 elements) ────────────────────────────────── */}
            <div className="grid grid-cols-5 gap-1.5 items-center">
              <Button variant="destructive" className="gap-2 px-5" onClick={() => setCurrentIndex(0)} disabled={currentIndex === 0}>◀◀</Button>
              <Button variant="destructive" className="gap-2 px-5" onClick={() => navigate(-1)} disabled={currentIndex === 0}>◀</Button>
              <div className="text-center text-sm font-medium border rounded px-3 py-1.5">
                {currentIndex + 1} / {totalRows}
              </div>
              <Button variant="destructive" className="gap-2 px-5" onClick={() => navigate(1)} disabled={currentIndex >= totalRows - 1}>▶</Button>
              <Button variant="destructive" className="gap-2 px-5" onClick={() => setCurrentIndex(totalRows - 1)} disabled={currentIndex >= totalRows - 1}>▶▶</Button>
            </div>
            <div className="text-[10px] text-muted-foreground text-center">
              ← → or h/l navigate &nbsp;·&nbsp; 1–9 toggle codes
            </div>

            {/* ── Session bar (below navigation) ────────────────────────────── */}
            <div className="space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-sm">
                <span className="font-medium">Session: </span>
                <code className="text-red-600 dark:text-red-400 text-xs bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded">
                  {sessionName || dataName || "untitled"}
                </code>
                <span className="text-muted-foreground ml-2 text-xs">
                  ({codedCount}/{totalRows} coded · {aiCount} AI)
                </span>
              </div>
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
            {/* Progress bar */}
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div className="bg-red-500 h-full transition-all duration-500" style={{ width: `${totalRows > 0 ? (codedCount / totalRows) * 100 : 0}%` }} />
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
                    const coded = Object.values(s.codingData || {}).filter((c) => c.length > 0).length;
                    return (
                      <div key={s.name} className="flex items-center justify-between p-2 rounded hover:bg-muted/30 border">
                        <div>
                          <span className="text-sm font-medium">{s.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">
                            {s.data.length} rows · {coded} coded · {new Date(s.savedAt).toLocaleDateString()}
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

            {/* Table panel */}
            {showTable && (() => {
              const pageSize = 10;
              const totalTablePages = Math.ceil(data.length / pageSize);
              const pageData = data.slice(tablePage * pageSize, (tablePage + 1) * pageSize);
              const startIdx = tablePage * pageSize;
              return (
                <div className="border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b font-medium text-sm flex items-center justify-between">
                    <span>Records</span>
                    <span className="text-xs text-muted-foreground font-normal">{totalRows} rows</span>
                  </div>
                  <div className="divide-y">
                    {pageData.map((row, pi) => {
                      const i = startIdx + pi;
                      const rowCodes = codingData[i] ?? [];
                      const firstCol = Object.values(row).map(String).join(" · ").slice(0, 80);
                      return (
                        <button key={i} onClick={() => { setCurrentIndex(i); setShowTable(false); }}
                          className={cn(
                            "w-full text-left px-4 py-2.5 hover:bg-muted/30 transition-colors flex items-center gap-3",
                            i === currentIndex && "bg-muted/50"
                          )}>
                          <span className="text-xs text-muted-foreground w-8 shrink-0">{i + 1}</span>
                          <span className="text-sm flex-1 truncate">{firstCol}</span>
                          <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end max-w-[50%]">
                            {aiData[i]?.codes?.slice(0, 1).map((c) => (
                              <span key={`ai-${c}`} className="text-[10px] px-1.5 py-0.5 rounded border border-orange-300 text-orange-600 dark:border-orange-800 dark:text-orange-400 truncate max-w-[80px]">
                                {c}
                              </span>
                            ))}
                            {rowCodes.map((c) => (
                              <span key={`h-${c}`} className="text-[10px] px-1.5 py-0.5 rounded font-medium truncate max-w-[80px]"
                                style={{ backgroundColor: codeColor(c, codes), color: "#1a1a1a" }}>
                                {c}
                              </span>
                            ))}
                            {!aiData[i]?.codes?.length && rowCodes.length === 0 && (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {totalTablePages > 1 && (
                    <div className="px-3 py-2 flex items-center justify-between text-xs text-muted-foreground border-t bg-muted/20">
                      <span>{data.length} rows</span>
                      <div className="flex items-center gap-2">
                        <span>
                          {tablePage * pageSize + 1}&ndash;{Math.min((tablePage + 1) * pageSize, data.length)} of {data.length}
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

          </>
        )}
      </div>

      <div className="border-t" />

      {/* ── 6. Export Results ───────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">6. Export Results</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Analytics */}
          <Button variant="destructive" className="gap-2 px-5" onClick={() => setShowAnalytics((v) => !v)} disabled={codedCount === 0 && aiCount === 0}>
            <BarChart2 className="h-3.5 w-3.5 mr-1.5" /> Analytics
          </Button>

          {/* Export Human Codes */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={codedCount === 0}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export Human Codes <ChevronDown className="h-3 w-3 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => {
                const base = (dataName || "data").replace(/\.[^.]+$/, "");
                void downloadCSVFile(buildExportRows(data, codes, codingData, aiData, "standard"), `${base}_human_standard.csv`);
              }}>CSV (standard)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const base = (dataName || "data").replace(/\.[^.]+$/, "");
                void downloadCSVFile(buildExportRows(data, codes, codingData, aiData, "onehot"), `${base}_human_onehot.csv`);
              }}>CSV (one-hot)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const base = (dataName || "data").replace(/\.[^.]+$/, "");
                void downloadXLSX(buildExportRows(data, codes, codingData, aiData, "standard"), `${base}_human_codes`);
              }}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const base = (dataName || "data").replace(/\.[^.]+$/, "");
                exportJSON(buildExportRows(data, codes, codingData, aiData, "standard"), `${base}_human_codes.json`);
              }}>JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Export with AI */}
          {aiCount > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export with AI <ChevronDown className="h-3 w-3 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => {
                  const base = (dataName || "data").replace(/\.[^.]+$/, "");
                  void downloadCSVFile(buildExportRows(data, codes, codingData, aiData, "withAI"), `${base}_with_ai.csv`);
                }}>CSV (standard)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const base = (dataName || "data").replace(/\.[^.]+$/, "");
                  void downloadCSVFile(buildExportRows(data, codes, codingData, aiData, "onehotAI"), `${base}_with_ai_onehot.csv`);
                }}>CSV (one-hot)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const base = (dataName || "data").replace(/\.[^.]+$/, "");
                  void downloadXLSX(buildExportRows(data, codes, codingData, aiData, "withAI"), `${base}_with_ai`);
                }}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const base = (dataName || "data").replace(/\.[^.]+$/, "");
                  exportJSON(buildExportRows(data, codes, codingData, aiData, "withAI"), `${base}_with_ai.json`);
                }}>JSON</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* ── Analytics (inline) ──────────────────────────────────────────── */}
        {showAnalytics && (
          <AnalyticsPanel
            codebook={codebook}
            results={data.map((row, i) => ({
              ...row,
              ai_codes: (aiData[i]?.codes ?? []).join(", "),
            }))}
            overrides={codingData}
            aiData={aiData}
            onGoToRow={(idx) => {
              setCurrentIndex(idx);
            }}
          />
        )}
      </div>

      {/* ── Delete session confirmation ─────────────────────────────────── */}
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

      {/* ── Pending load dialog ───────────────────────────────────────────── */}
      <Dialog open={!!pendingLoad} onOpenChange={(open) => { if (!open) setPendingLoad(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Replace current session?</DialogTitle>
            <DialogDescription>
              You have{" "}
              <strong>{codedCount} coded record{codedCount !== 1 ? "s" : ""}</strong>{" "}
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

// ─── Code Buttons Panel Component ────────────────────────────────────────────
function CodeButtonsPanel({
  codes,
  appliedCodes,
  currentSuggestion,
  horizontal,
  onToggle,
}: {
  codes: string[];
  appliedCodes: string[];
  currentSuggestion?: AISuggestion;
  horizontal: boolean;
  onToggle: (code: string) => void;
}) {
  const suggestedCodes = currentSuggestion?.codes ?? [];
  const confidence = currentSuggestion?.confidence ?? {};
  // Only the highest-probability code gets the "AI suggested" highlight
  const topSuggested = suggestedCodes.length > 0 ? suggestedCodes[0] : null;

  if (horizontal) {
    return (
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${codes.length}, 1fr)` }}>
        {codes.map((code, idx) => {
          const color = codeColor(code, codes);
          const isApplied = appliedCodes.includes(code);
          const confValue = confidence[code] ?? 0;
          const isSuggested = code === topSuggested;
          return (
            <button
              key={code}
              onClick={() => onToggle(code)}
              className={cn(
                "relative rounded border text-xs py-2 px-1 transition-all hover:shadow-sm active:scale-[0.98] flex flex-col items-center gap-0.5",
                isApplied ? "font-semibold shadow-sm" : "font-normal"
              )}
              style={{
                backgroundColor: isApplied ? color : isSuggested ? color + "30" : "transparent",
                borderTopWidth: "4px",
                borderTopColor: color,
                borderRightColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
                borderBottomColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
                borderLeftColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
              }}
            >
              {idx < 9 && <span className="text-[9px] opacity-40 absolute top-0.5 right-1">{idx + 1}</span>}
              <span>
                {code}
                {confValue > 0 && <span className="text-[10px] opacity-60 ml-1">({Math.round(confValue)}%)</span>}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // Vertical list
  return (
    <div className="space-y-1">
      {codes.map((code, idx) => {
        const color = codeColor(code, codes);
        const isApplied = appliedCodes.includes(code);
        const confValue = confidence[code] ?? 0;
        const isSuggested = code === topSuggested;
        return (
          <button
            key={code}
            onClick={() => onToggle(code)}
            className="relative w-full rounded border text-sm py-2 px-4 text-left transition-all hover:shadow-sm active:scale-[0.99] flex items-center justify-between"
            style={{
              backgroundColor: isApplied ? color : isSuggested ? color + "30" : "transparent",
              borderLeftWidth: "4px",
              borderLeftColor: color,
              borderRightColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
              borderBottomColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
              borderTopColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
            }}
          >
            {idx < 9 && <span className="text-[9px] opacity-40 absolute top-0.5 right-1">{idx + 1}</span>}
            <span>
              {code}
              {confValue > 0 && <span className="text-[10px] opacity-60 ml-1">({Math.round(confValue)}%)</span>}
            </span>
            <div className="flex items-center gap-2">
              {isApplied && <Check className="h-3.5 w-3.5 opacity-70" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
