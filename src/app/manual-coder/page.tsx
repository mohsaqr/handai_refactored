"use client";

import React, { useState, useEffect, useCallback } from "react";
import { FileUploader } from "@/components/tools/FileUploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import {
  ChevronRight,
  ChevronDown,
  Save,
  FolderOpen,
  Download,
  MousePointer2,
  Trash2,
  Minus,
  Plus,
  X,
  BarChart2,
  ArrowLeft,
} from "lucide-react";
import { SampleDatasetPicker } from "@/components/tools/SampleDatasetPicker";
import { toast } from "sonner";
import type { Row } from "@/types";
import { cn } from "@/lib/utils";

// ─── Palette (matches Python CODE_COLORS) ─────────────────────────────────
const CODE_COLORS = [
  "#FFF3BF", // Soft yellow
  "#C3FAE8", // Soft teal
  "#D0EBFF", // Soft blue
  "#F3D9FA", // Soft purple
  "#FFE8CC", // Soft orange
  "#FFDEEB", // Soft pink
  "#D3F9D8", // Soft green
  "#E3FAFC", // Soft cyan
];

function codeColor(code: string, allCodes: string[]): string {
  return CODE_COLORS[allCodes.indexOf(code) % CODE_COLORS.length];
}

// ─── Sample codes per dataset (matches Python SAMPLE_CODES) ───────────────
const SAMPLE_CODES: Record<string, string[]> = {
  product_reviews: ["Positive", "Negative", "Neutral", "Mixed", "Quality Issue", "Shipping Issue"],
  healthcare_interviews: ["Burnout", "Resilience", "Team Support", "Resource Issue", "Leadership", "Work-Life Balance"],
  support_tickets: ["Bug", "Feature Request", "Billing", "Account Issue", "Shipping", "Refund"],
  learning_experience: ["Positive Experience", "Negative Experience", "Technical Issue", "Engagement", "Isolation", "Flexibility"],
  exit_interviews: ["Compensation", "Career Growth", "Management", "Work-Life Balance", "Culture", "Relocation"],
  mixed_feedback: ["Positive", "Negative", "Neutral", "Detailed", "Brief"],
};

const SAMPLE_HIGHLIGHTS: Record<string, Record<string, string>> = {
  product_reviews: {
    "Positive": "love, amazing, great, excellent, fantastic, happy, best, perfect",
    "Negative": "terrible, worst, broke, waste, disappointed, bad, poor, hate",
    "Neutral": "okay, fine, decent, average, nothing special",
  },
  healthcare_interviews: {
    "Burnout": "exhausted, burnout, tired, overwhelmed, stress",
    "Resilience": "keeps me going, purpose, proud",
    "Team Support": "team, colleagues, support, together",
  },
};

// ─── Storage ───────────────────────────────────────────────────────────────
const SESSIONS_KEY = "mc_named_sessions";
const SETTINGS_KEY = "mc_settings";

interface MCSession {
  name: string;
  savedAt: string;
  data: Row[];
  codes: string[];
  highlights: Record<string, string>;
  codingData: Record<number, string[]>;
  currentIndex: number;
  textCols: string[];
  dataName?: string;
}

interface MCSettings {
  contextRows: number;
  autoAdvance: boolean;
  lightMode: boolean;
  horizontalCodes: boolean;
}

function listSessions(): MCSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as MCSession[]).sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );
  } catch { return []; }
}
function upsertSession(s: MCSession) {
  const all = listSessions();
  const i = all.findIndex((x) => x.name === s.name);
  if (i >= 0) all[i] = s; else all.unshift(s);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
}
function deleteStoredSession(name: string) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(listSessions().filter((s) => s.name !== name)));
}
function loadSettings(): MCSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { contextRows: 2, autoAdvance: false, lightMode: true, horizontalCodes: true };
  } catch { return { contextRows: 2, autoAdvance: false, lightMode: true, horizontalCodes: true }; }
}
function saveSettings(s: MCSettings) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

// ─── Export ─────────────────────────────────────────────────────────────────
function exportCSV(data: Row[], codes: string[], codingData: Record<number, string[]>, mode: "standard" | "onehot") {
  const rows = mode === "standard"
    ? data.map((row, i) => ({ ...row, codes: (codingData[i] || []).join("; ") }))
    : data.map((row, i) => {
        const applied = codingData[i] || [];
        const oneHot: Record<string, number> = {};
        codes.forEach((c) => (oneHot[c] = applied.includes(c) ? 1 : 0));
        return { ...row, ...oneHot };
      });
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => `"${String((r as Record<string, unknown>)[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = mode === "onehot" ? "coded_onehot.csv" : "coded_data.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Word highlight ───────────────────────────────────────────────────────
function highlightText(text: string, code: string, color: string, words: string): string {
  if (!words.trim()) return text;
  const terms = words.split(",").map((w) => w.trim()).filter(Boolean);
  let result = text;
  terms.forEach((term) => {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    result = result.replace(regex, `<mark style="background-color:${color};padding:0 2px;border-radius:2px;">$1</mark>`);
  });
  return result;
}

function applyAllHighlights(text: string, codes: string[], allCodes: string[], highlights: Record<string, string>): string {
  let result = text;
  codes.forEach((code) => {
    const color = codeColor(code, allCodes);
    if (highlights[code]) result = highlightText(result, code, color, highlights[code]);
  });
  return result;
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function ManualCoderPage() {
  const [data, setData] = useState<Row[]>([]);
  const [codes, setCodes] = useState<string[]>(["Positive", "Negative", "Neutral", "Detailed", "Brief"]);
  const [highlights, setHighlights] = useState<Record<string, string>>({});
  const [codingData, setCodingData] = useState<Record<number, string[]>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [textCols, setTextCols] = useState<string[]>([]);
  const [dataName, setDataName] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [settings, setSettings] = useState<MCSettings>({ contextRows: 2, autoAdvance: false, lightMode: true, horizontalCodes: true });
  const [sessions, setSessions] = useState<MCSession[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showHighlighter, setShowHighlighter] = useState(false);
  const [showTextColPicker, setShowTextColPicker] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [codesInput, setCodesInput] = useState("Positive\nNegative\nNeutral\nDetailed\nBrief");

  useEffect(() => {
    setSettings(loadSettings());
    setSessions(listSessions());
  }, []);

  const totalRows = data.length;
  const currentRow = data[currentIndex] as Row | undefined;
  const appliedCodes = codingData[currentIndex] || [];
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const codedCount = Object.keys(codingData).filter((k) => (codingData[parseInt(k)] || []).length > 0).length;

  const handleDataLoaded = (newData: Row[], name: string, sampleKey?: string) => {
    setData(newData);
    setDataName(name);
    setCodingData({});
    setCurrentIndex(0);
    const cols = Object.keys(newData[0] || {});
    const textish = cols.filter((c) => String(newData[0][c] || "").length > 20);
    setTextCols(textish.length > 0 ? textish : cols);
    const sName = name.replace(/\.[^.]+$/, "");
    setSessionName(sName);
    if (sampleKey && SAMPLE_CODES[sampleKey]) {
      const sc = SAMPLE_CODES[sampleKey];
      setCodes(sc);
      setCodesInput(sc.join("\n"));
      setHighlights(SAMPLE_HIGHLIGHTS[sampleKey] || {});
    }
    toast.success(`Loaded ${newData.length} rows`);
  };

  const loadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (s) handleDataLoaded(s.data as Row[], s.name, key);
  };

  const applyCodesFromInput = () => {
    const parsed = codesInput.split("\n").map((c) => c.trim()).filter(Boolean);
    if (parsed.length > 0) setCodes(parsed);
  };

  const toggleCode = (code: string) => {
    const wasApplied = appliedCodes.includes(code);
    setCodingData((prev) => {
      const cur = prev[currentIndex] || [];
      return { ...prev, [currentIndex]: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code] };
    });
    if (!wasApplied && settings.autoAdvance && currentIndex < totalRows - 1) {
      setTimeout(() => setCurrentIndex((i) => Math.min(i + 1, totalRows - 1)), 200);
    }
  };

  const navigate = (dir: number) => setCurrentIndex((i) => Math.max(0, Math.min(totalRows - 1, i + dir)));

  const updateSettings = (patch: Partial<MCSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  const saveSession = (name?: string) => {
    const n = (name || sessionName || dataName || "Session").trim();
    const s: MCSession = { name: n, savedAt: new Date().toISOString(), data, codes, highlights, codingData, currentIndex, textCols, dataName };
    upsertSession(s);
    setSessions(listSessions());
    setSessionName(n);
    setShowSaveDialog(false);
    toast.success(`Saved "${n}"`);
  };

  const loadSession = (s: MCSession) => {
    setData(s.data); setCodes(s.codes); setCodesInput(s.codes.join("\n"));
    setHighlights(s.highlights || {}); setCodingData(s.codingData);
    setCurrentIndex(s.currentIndex); setTextCols(s.textCols);
    setDataName(s.dataName || ""); setSessionName(s.name);
    setShowSessions(false);
    toast.success(`Loaded "${s.name}"`);
  };

  // Build highlighted row HTML
  const getRowHtml = (row: Row, rowIdx: number, isCurrent: boolean): string => {
    const displayCols = textCols.length > 0 ? textCols : allColumns;
    const allApplied = codingData[rowIdx] || [];
    let html = "";
    if (isCurrent) {
      const badges = allApplied.map((c) => `<span style="background:${codeColor(c, codes)};padding:1px 6px;border-radius:3px;font-size:0.8em;margin-left:4px;">${c}</span>`).join("");
      html += `<strong>► Row ${rowIdx + 1} of ${totalRows}</strong>${badges}<br/>`;
    }
    displayCols.forEach((col) => {
      const val = String(row[col] ?? "");
      const highlighted = applyAllHighlights(val, allApplied, codes, highlights);
      if (displayCols.length > 1 || !isCurrent) {
        html += `<b>${col}:</b> ${highlighted} `;
      } else {
        html += highlighted;
      }
    });
    return html;
  };

  // Context rows: N before + current + N after
  const contextRange = (() => {
    const n = settings.contextRows;
    const rows: number[] = [];
    for (let i = Math.max(0, currentIndex - n); i <= Math.min(totalRows - 1, currentIndex + n); i++) rows.push(i);
    return rows;
  })();

  const lightBg = settings.lightMode ? "#FFFEF5" : "#1a1a2e";
  const lightText = settings.lightMode ? "#1a1a1a" : "#eee";
  const ctxBg = settings.lightMode ? "#F8F9FA" : "rgba(128,128,128,0.15)";
  const ctxText = settings.lightMode ? "#555" : "#bbb";

  // ─── Config screen ────────────────────────────────────────────────────────
  if (data.length === 0) {
    return (
      <div className="max-w-4xl mx-auto space-y-5 pb-16">
        <div className="space-y-1">
          <h1 className="text-4xl font-bold">Manual Coder</h1>
          <p className="text-muted-foreground text-sm">High-speed manual qualitative coding — no AI required</p>
        </div>

        {/* Saved sessions */}
        {sessions.length > 0 && (
          <div className="border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b font-medium text-sm">Resume a Session</div>
            <div className="p-3 space-y-2">
              {sessions.slice(0, 6).map((s) => {
                const coded = Object.keys(s.codingData).filter((k) => (s.codingData[parseInt(k)] || []).length > 0).length;
                return (
                  <div key={s.name} className="flex items-center justify-between p-2.5 rounded border hover:bg-muted/30">
                    <div>
                      <div className="text-sm font-medium">{s.name}</div>
                      <div className="text-[10px] text-muted-foreground">{s.data.length} rows · {coded} coded · {new Date(s.savedAt).toLocaleDateString()}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => loadSession(s)}>Load</Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => { deleteStoredSession(s.name); setSessions(listSessions()); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b font-medium text-sm">1. Load Data</div>
          <div className="p-4">
            <FileUploader onDataLoaded={handleDataLoaded} />
            <div className="mt-4">
              <SampleDatasetPicker onSelect={loadSample} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Coding interface ─────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-3">

      {/* ── Session bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-sm">
          <span className="font-medium">Session: </span>
          <code className="text-green-600 dark:text-green-400 text-xs bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">
            {sessionName || dataName || "untitled"}
          </code>
          <span className="text-muted-foreground ml-2 text-xs">({codedCount}/{totalRows} coded)</span>
        </div>
        <div className="flex gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => setShowSaveDialog((v) => !v)}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowSessions((v) => !v)}>
            <FolderOpen className="h-3.5 w-3.5 mr-1" /> Load
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAnalytics((v) => !v)}>
            <BarChart2 className="h-3.5 w-3.5 mr-1" /> Analytics
          </Button>
          <Button size="sm" variant="outline" onClick={() => exportCSV(data, codes, codingData, "standard")} title="Export standard CSV">
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => exportCSV(data, codes, codingData, "onehot")} title="One-hot encoding">
            1/0
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setData([]); setCodingData({}); }} title="Close session">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Save dialog */}
      {showSaveDialog && (
        <div className="flex gap-2 items-center p-3 bg-muted/30 rounded-lg border">
          <Input
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            placeholder="Session name..."
            className="h-8 text-sm"
            onKeyDown={(e) => e.key === "Enter" && saveSession()}
            autoFocus
          />
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
              const coded = Object.keys(s.codingData).filter((k) => (s.codingData[parseInt(k)] || []).length > 0).length;
              return (
                <div key={s.name} className="flex items-center justify-between p-2 rounded hover:bg-muted/30 border">
                  <div>
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-2">{s.data.length} rows · {coded} coded · {new Date(s.savedAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7" onClick={() => loadSession(s)}>Load</Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => { deleteStoredSession(s.name); setSessions(listSessions()); }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            }) : <p className="text-sm text-muted-foreground p-2">No saved sessions</p>}
          </div>
        </div>
      )}

      {/* ── Analytics panel ───────────────────────────────────────────────── */}
      {showAnalytics && (() => {
        const codeStats = codes.map((code) => {
          const count = Object.values(codingData).filter((cds) => cds.includes(code)).length;
          const multiCount = Object.values(codingData).filter((cds) => cds.length > 1 && cds.includes(code)).length;
          return { code, count, multiCount };
        });
        const multiCodeRows = Object.values(codingData).filter((cds) => cds.length > 1).length;
        return (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/20 font-medium text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><BarChart2 className="h-4 w-4 text-green-500" /> Analytics — {sessionName || dataName}</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowAnalytics(false)}><X className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="p-4 space-y-5">
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Total Rows", value: totalRows, color: "text-foreground" },
                  { label: "Coded", value: codedCount, color: "text-green-600" },
                  { label: "Uncoded", value: totalRows - codedCount, color: "text-muted-foreground" },
                  { label: "Progress", value: `${Math.round((codedCount / totalRows) * 100)}%`, color: "text-green-600" },
                ].map((s) => (
                  <div key={s.label} className="border rounded-lg p-3 text-center">
                    <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
              {/* Progress bar */}
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div className="bg-green-500 h-full transition-all" style={{ width: `${(codedCount / totalRows) * 100}%` }} />
              </div>
              {/* Code frequency */}
              <div>
                <div className="text-sm font-semibold mb-3">Code Frequency</div>
                <div className="space-y-2">
                  {codeStats.sort((a, b) => b.count - a.count).map(({ code, count }) => {
                    const color = codeColor(code, codes);
                    const pct = totalRows > 0 ? (count / totalRows) * 100 : 0;
                    return (
                      <div key={code} className="flex items-center gap-3">
                        <span className="text-xs w-36 truncate shrink-0 font-medium" title={code}>{code}</span>
                        <div className="flex-1 bg-muted rounded h-5 overflow-hidden">
                          <div className="h-full rounded transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                        <span className="text-xs text-right w-24 shrink-0 text-muted-foreground">
                          {count} rows ({Math.round(pct)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Multi-code info */}
              <div className="text-xs text-muted-foreground border-t pt-3">
                <span className="font-medium">{multiCodeRows}</span> rows have multiple codes applied ·{" "}
                <span className="font-medium">{Object.values(codingData).reduce((sum, cds) => sum + cds.length, 0)}</span> total code assignments
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Word Highlighter (collapsible) ──────────────────────────────── */}
      <Collapsible open={showHighlighter} onOpenChange={setShowHighlighter}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm w-full px-3 py-2 rounded border hover:bg-muted/30 transition-colors">
          {showHighlighter ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Word Highlighter — Define words to highlight for each code
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 border rounded-lg p-3 space-y-2 bg-muted/10">
            {codes.map((code) => {
              const color = codeColor(code, codes);
              return (
                <div key={code} className="flex items-center gap-3">
                  <div className="text-xs font-semibold px-2 py-1 rounded shrink-0 w-36 text-center" style={{ backgroundColor: color }}>
                    {code}
                  </div>
                  <Input
                    value={highlights[code] || ""}
                    onChange={(e) => setHighlights((prev) => ({ ...prev, [code]: e.target.value }))}
                    placeholder="word1, word2, phrase..."
                    className="h-7 text-xs flex-1"
                  />
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Text Columns selector (collapsible once set) ─────────────────── */}
      <Collapsible open={showTextColPicker} onOpenChange={setShowTextColPicker}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm w-full px-3 py-2 rounded border hover:bg-muted/30 transition-colors">
          {showTextColPicker ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Text Columns: <strong className="ml-1">{textCols.join(", ")}</strong>
          <span className="text-muted-foreground text-xs ml-1">(click to change)</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 border rounded-lg p-3 bg-muted/10">
            <div className="flex flex-wrap gap-2">
              {allColumns.map((col) => (
                <Badge
                  key={col}
                  variant={textCols.includes(col) ? "default" : "outline"}
                  className="cursor-pointer text-xs hover:opacity-80"
                  onClick={() => setTextCols((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col])}
                >
                  {col}
                </Badge>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Settings toggles row ─────────────────────────────────────────── */}
      <div className="flex items-center gap-6 flex-wrap text-sm border rounded-lg px-4 py-2.5 bg-muted/10">
        <div className="flex items-center gap-2">
          <Switch id="light-mode" checked={settings.lightMode} onCheckedChange={(v) => updateSettings({ lightMode: v })} />
          <Label htmlFor="light-mode" className="text-xs cursor-pointer">Light mode</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="horiz" checked={settings.horizontalCodes} onCheckedChange={(v) => updateSettings({ horizontalCodes: v })} />
          <Label htmlFor="horiz" className="text-xs cursor-pointer">Horizontal codes</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="auto" checked={settings.autoAdvance} onCheckedChange={(v) => updateSettings({ autoAdvance: v })} />
          <Label htmlFor="auto" className="text-xs cursor-pointer">Auto-advance</Label>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Label className="text-xs">Context</Label>
          <div className="flex items-center border rounded overflow-hidden">
            <button className="px-2 py-1 hover:bg-muted text-sm" onClick={() => updateSettings({ contextRows: Math.max(0, settings.contextRows - 1) })}>
              <Minus className="h-3 w-3" />
            </button>
            <span className="px-3 py-1 text-sm border-x min-w-[2rem] text-center">{settings.contextRows}</span>
            <button className="px-2 py-1 hover:bg-muted text-sm" onClick={() => updateSettings({ contextRows: Math.min(5, settings.contextRows + 1) })}>
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Text display with context ────────────────────────────────────── */}
      <div
        className="rounded-lg border overflow-hidden"
        style={{ minHeight: "280px" }}
      >
        {contextRange.map((rowIdx) => {
          const isCurrent = rowIdx === currentIndex;
          const row = data[rowIdx];
          if (!row) return null;
          return (
            <div
              key={rowIdx}
              className="px-4 py-3"
              style={isCurrent
                ? { backgroundColor: lightBg, color: lightText, borderLeft: "4px solid #4CAF50", fontSize: "1.05em" }
                : { backgroundColor: ctxBg, color: ctxText, borderLeft: "4px solid transparent", fontSize: "0.93em", opacity: 0.85 }
              }
              dangerouslySetInnerHTML={{ __html: getRowHtml(row, rowIdx, isCurrent) }}
            />
          );
        })}
      </div>

      {/* ── Code buttons (full-width horizontal) ─────────────────────────── */}
      {settings.horizontalCodes ? (
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${codes.length}, 1fr)` }}>
          {codes.map((code) => {
            const color = codeColor(code, codes);
            const isApplied = appliedCodes.includes(code);
            return (
              <button
                key={code}
                onClick={() => toggleCode(code)}
                className={cn(
                  "rounded border text-sm py-2 px-2 transition-all hover:shadow-sm active:scale-[0.98] relative",
                  isApplied ? "font-semibold shadow-sm" : "font-normal"
                )}
                style={{
                  backgroundColor: isApplied ? color : "transparent",
                  borderColor: isApplied ? color : "#e2e8f0",
                  borderTopWidth: "4px",
                  borderTopColor: color,
                }}
              >
                {code}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1">
          {codes.map((code) => {
            const color = codeColor(code, codes);
            const isApplied = appliedCodes.includes(code);
            return (
              <button
                key={code}
                onClick={() => toggleCode(code)}
                className="w-full rounded border text-sm py-2 px-4 text-left transition-all hover:shadow-sm active:scale-[0.99] relative"
                style={{
                  backgroundColor: isApplied ? color : "transparent",
                  borderColor: isApplied ? color : "#e2e8f0",
                  borderLeftWidth: "4px",
                  borderLeftColor: color,
                  fontWeight: isApplied ? 600 : 400,
                }}
              >
                {code}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Big Next button ───────────────────────────────────────────────── */}
      <Button
        className="w-full h-10 text-base"
        disabled={currentIndex >= totalRows - 1}
        onClick={() => navigate(1)}
      >
        Next ▶
      </Button>

      {/* ── Navigation bar ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate(-5)} disabled={currentIndex === 0}>◀◀</Button>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)} disabled={currentIndex === 0}>◀ Prev</Button>
        <Button variant="outline" size="sm" onClick={() => navigate(1)} disabled={currentIndex >= totalRows - 1}>Next ▶</Button>
        <Button variant="outline" size="sm" onClick={() => navigate(totalRows - 1 - currentIndex)} disabled={currentIndex >= totalRows - 1}>▶▶</Button>
      </div>

      {/* ── Progress counter + applied codes ─────────────────────────────── */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>{codedCount}/{totalRows} coded</span>
        <div className="flex flex-wrap gap-1.5 justify-end">
          {appliedCodes.map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-70"
              style={{ backgroundColor: codeColor(code, codes) }}
              onClick={() => toggleCode(code)}
              title="Click to remove"
            >
              {code} <X className="h-2.5 w-2.5" />
            </span>
          ))}
        </div>
      </div>

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
        <div className="bg-green-500 h-full transition-all duration-500" style={{ width: `${(codedCount / totalRows) * 100}%` }} />
      </div>

      {/* ── Export Results section ─────────────────────────────────────────── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/20 font-medium text-sm">Export Results</div>
        <div className="p-4">
          {codedCount === 0 ? (
            <p className="text-sm text-muted-foreground">Code some rows before exporting</p>
          ) : (
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => exportCSV(data, codes, codingData, "standard")}>
                <Download className="h-4 w-4 mr-2" /> Export CSV (standard)
              </Button>
              <Button variant="outline" onClick={() => exportCSV(data, codes, codingData, "onehot")}>
                <Download className="h-4 w-4 mr-2" /> Export CSV (one-hot)
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
