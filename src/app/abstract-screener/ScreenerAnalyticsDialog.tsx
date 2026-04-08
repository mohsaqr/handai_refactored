"use client";

import React, { useState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import {
  interpretKappa,
} from "@/lib/analytics";

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

const DECISION_LABELS = ["include", "maybe", "exclude"] as const;
type DecisionLabel = (typeof DECISION_LABELS)[number];

const DECISION_COLORS: Record<DecisionLabel, string> = {
  include: "#C3FAE8",
  maybe: "#FFF3BF",
  exclude: "#FFDEEB",
};

function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

// ── Cohen's Kappa for binary vectors ──────────────────────────────────
function computeKappa(
  humanVec: DecisionLabel[],
  aiVec: DecisionLabel[],
): number {
  const n = humanVec.length;
  if (n === 0) return NaN;
  let agree = 0;
  const humanCounts: Record<string, number> = {};
  const aiCounts: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    if (humanVec[i] === aiVec[i]) agree++;
    humanCounts[humanVec[i]] = (humanCounts[humanVec[i]] ?? 0) + 1;
    aiCounts[aiVec[i]] = (aiCounts[aiVec[i]] ?? 0) + 1;
  }
  const po = agree / n;
  let pe = 0;
  for (const label of DECISION_LABELS) {
    pe += ((humanCounts[label] ?? 0) / n) * ((aiCounts[label] ?? 0) / n);
  }
  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

// ── F1 Score ──────────────────────────────────────────────────────────
function f1Score(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

// ── KappaBadge ────────────────────────────────────────────────────────
function KappaBadge({ kappa }: { kappa: number }) {
  const label = interpretKappa(kappa);
  const isNA = isNaN(kappa);
  const bg = isNA
    ? "bg-muted text-muted-foreground"
    : kappa < 0.2
      ? "bg-red-100 text-red-700"
      : kappa < 0.4
        ? "bg-orange-100 text-orange-700"
        : kappa < 0.6
          ? "bg-yellow-100 text-yellow-700"
          : kappa < 0.8
            ? "bg-blue-100 text-blue-700"
            : "bg-green-100 text-green-700";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${bg}`}>
      {isNA ? "N/A" : kappa.toFixed(2)} · {label}
    </span>
  );
}

// ── Mosaic Plot ───────────────────────────────────────────────────────
function MosaicPlot({
  matrix,
  colTotals,
  rowTotals,
  grandTotal,
  svgRef,
}: {
  matrix: number[][];
  colTotals: number[];
  rowTotals: number[];
  grandTotal: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}) {
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; human: string; ai: string; val: number; colPct: number; rowPct: number;
  } | null>(null);

  if (grandTotal === 0) {
    return (
      <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
        No overlap data to display. Both AI and human decisions are needed.
      </div>
    );
  }

  const plotW = 500;
  const plotH = 300;
  const marginL = 80;
  const marginT = 45;
  const marginR = 10;
  const marginB = 10;
  const availW = plotW - marginL - marginR;
  const availH = plotH - marginT - marginB;
  const gap = 2;

  const colWidths = DECISION_LABELS.map((_, j) =>
    colTotals[j] > 0 ? (colTotals[j] / grandTotal) * availW : 0,
  );

  const rects: React.ReactNode[] = [];
  let colX = marginL;

  for (let j = 0; j < 3; j++) {
    if (colWidths[j] <= 0) { colX += colWidths[j]; continue; }
    let cellY = marginT;
    const colTotal = colTotals[j];

    for (let i = 0; i < 3; i++) {
      const val = matrix[i][j];
      if (val <= 0) continue;
      const cellH = (val / colTotal) * availH;
      const isDiag = i === j;
      const opacity = isDiag ? 0.85 : 0.15 + 0.7 * (val / colTotal);
      const color = DECISION_COLORS[DECISION_LABELS[i]];

      rects.push(
        <rect
          key={`${i}-${j}`}
          x={colX + gap / 2}
          y={cellY + gap / 2}
          width={Math.max(colWidths[j] - gap, 0)}
          height={Math.max(cellH - gap, 0)}
          fill={hexToRgba(color, opacity)}
          stroke={color}
          strokeWidth={isDiag ? 1.5 : 0.5}
          rx={2}
          onMouseMove={(e) =>
            setTooltip({
              x: e.clientX,
              y: e.clientY,
              human: DECISION_LABELS[i],
              ai: DECISION_LABELS[j],
              val,
              colPct: colTotal > 0 ? (val / colTotal) * 100 : 0,
              rowPct: rowTotals[i] > 0 ? (val / rowTotals[i]) * 100 : 0,
            })
          }
          onMouseLeave={() => setTooltip(null)}
          className="cursor-pointer transition-opacity"
        />,
      );
      cellY += cellH;
    }
    colX += colWidths[j];
  }

  // X-axis labels (AI)
  const xLabels: React.ReactNode[] = [];
  let labelX = marginL;
  for (let j = 0; j < 3; j++) {
    if (colWidths[j] > 0) {
      xLabels.push(
        <text key={`xl-${j}`} x={labelX + colWidths[j] / 2} y={marginT - 8}
          textAnchor="middle" fontSize={10} fill="currentColor" className="text-muted-foreground capitalize">
          {DECISION_LABELS[j]}
        </text>,
      );
    }
    labelX += colWidths[j];
  }

  // Y-axis labels (Human)
  const yLabels: React.ReactNode[] = [];
  let rowY = marginT;
  for (let i = 0; i < 3; i++) {
    const rowH = rowTotals[i] > 0 ? (rowTotals[i] / grandTotal) * availH : 0;
    if (rowH > 0) {
      yLabels.push(
        <text key={`yl-${i}`} x={marginL - 6} y={rowY + rowH / 2}
          textAnchor="end" dominantBaseline="central" fontSize={10} fill="currentColor" className="text-muted-foreground capitalize">
          {DECISION_LABELS[i]}
        </text>,
      );
    }
    rowY += rowH;
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
        Mosaic Plot
        <span className="text-xs font-normal text-muted-foreground ml-2">
          Column width = AI decision frequency · Cell height = human share · Opacity = agreement density
        </span>
      </div>
      <div className="p-4 relative">
        <svg ref={svgRef} viewBox={`0 0 ${plotW} ${plotH}`} className="w-full" style={{ maxHeight: 340 }}>
          <text x={plotW / 2} y={12} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor">AI Decisions</text>
          <text x={12} y={plotH / 2} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor" transform={`rotate(-90, 12, ${plotH / 2})`}>Human Decisions</text>
          {xLabels}
          {yLabels}
          {rects}
        </svg>
        {tooltip && (
          <div className="fixed z-50 bg-foreground text-background rounded-md px-3 py-2 text-xs pointer-events-none shadow-lg"
            style={{ left: tooltip.x + 14, top: tooltip.y - 32 }}>
            <div className="font-semibold mb-1 capitalize">Human: {tooltip.human} × AI: {tooltip.ai}</div>
            <div>Count: {tooltip.val}</div>
            <div>% of AI column: {tooltip.colPct.toFixed(1)}%</div>
            <div>% of Human row: {tooltip.rowPct.toFixed(1)}%</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Export HTML Report ─────────────────────────────────────────────────
interface ExportData {
  totalRows: number;
  aiCount: number;
  decidedCount: number;
  includeCount: number;
  excludeCount: number;
  maybeCount: number;
  agreementRate: string;
  overallKappa: number;
  overallF1: string;
  decisionStats: { decision: string; aiCount: number; humanCount: number; tp: number; precision: string; recall: string; f1: string }[];
  matrix: number[][];
  perDecKappa: { pctAgree: number; kappa: number }[];
  disagreements: { idx: number; title: string; aiDecision: string; humanDecision: string; aiConfidence: number }[];
  mosaicSvg: string;
}

function exportAnalyticsHTML(data: ExportData) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const EXPORT_COLORS: Record<string, { bg: string; text: string; solid: string }> = {
    include: { bg: "#C3FAE8", text: "#0b7a4b", solid: "#22c55e" },
    maybe: { bg: "#FFF3BF", text: "#92600a", solid: "#f59e0b" },
    exclude: { bg: "#FFDEEB", text: "#c2185b", solid: "#ef4444" },
  };

  const kpiCards = [
    { label: "Total Rows", value: String(data.totalRows), color: "#1a1a1a" },
    { label: "AI Processed", value: `${data.aiCount} (${data.totalRows > 0 ? Math.round((data.aiCount / data.totalRows) * 100) : 0}%)`, color: "#f97316" },
    { label: "Human Screened", value: String(data.decidedCount), color: "#16a34a" },
    { label: "AI Agreement", value: data.agreementRate === "—" ? "—" : `${data.agreementRate}%`, color: "#2563eb" },
    { label: "Cohen's Kappa", value: isNaN(data.overallKappa) ? "N/A" : `${data.overallKappa.toFixed(2)} (${interpretKappa(data.overallKappa)})`, color: data.overallKappa >= 0.6 ? "#16a34a" : data.overallKappa >= 0.4 ? "#ca8a04" : "#1a1a1a" },
    { label: "Overall F1", value: data.overallF1 === "—" ? "—" : `${data.overallF1}%`, color: "#9333ea" },
  ];

  const kpiHtml = kpiCards.map((k) =>
    `<div class="kpi"><div class="kpi-value" style="color:${k.color}">${esc(k.value)}</div><div class="kpi-label">${esc(k.label)}</div></div>`,
  ).join("");

  // Progress bar
  const progressParts = [
    { label: "Include", count: data.includeCount, color: "#22c55e" },
    { label: "Exclude", count: data.excludeCount, color: "#ef4444" },
    { label: "Maybe", count: data.maybeCount, color: "#f59e0b" },
    { label: "Undecided", count: data.totalRows - data.decidedCount, color: "#d1d5db" },
  ];
  const progressBarHtml = progressParts
    .filter((p) => p.count > 0)
    .map((p) => `<div style="width:${(p.count / data.totalRows) * 100}%;background:${p.color};height:12px"></div>`)
    .join("");
  const progressLegend = progressParts
    .filter((p) => p.count > 0)
    .map((p) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${p.color}"></span>${p.label} (${p.count})</span>`)
    .join("");

  const statsRows = data.decisionStats.map((s) => {
    const c = EXPORT_COLORS[s.decision] ?? { bg: "#f0f0f0", text: "#333" };
    return `<tr><td><span class="badge" style="background:${c.bg};color:${c.text}">${s.decision}</span></td>` +
      `<td>${s.aiCount}</td><td>${s.humanCount}</td><td style="font-weight:600">${s.tp}</td>` +
      `<td>${s.precision}${s.precision !== "—" ? "%" : ""}</td><td>${s.recall}${s.recall !== "—" ? "%" : ""}</td>` +
      `<td style="font-weight:600">${s.f1}${s.f1 !== "—" ? "%" : ""}</td></tr>`;
  }).join("");

  const matrixHeader = DECISION_LABELS.map((c) => {
    const col = EXPORT_COLORS[c] ?? { bg: "#f0f0f0", text: "#333" };
    return `<th><span class="badge" style="background:${col.bg};color:${col.text}">${c}</span></th>`;
  }).join("");
  const matrixRows = DECISION_LABELS.map((hDec, hIdx) => {
    const hCol = EXPORT_COLORS[hDec] ?? { bg: "#f0f0f0", text: "#333" };
    const maxCell = Math.max(...data.matrix.flat(), 1);
    const cells = DECISION_LABELS.map((_, aIdx) => {
      const val = data.matrix[hIdx][aIdx];
      const isDiag = hIdx === aIdx;
      const opacity = val > 0 ? 0.15 + 0.85 * (val / maxCell) : 0;
      const bg = val > 0 ? hexToRgba(hCol.bg, opacity) : "transparent";
      return `<td style="background:${bg};${isDiag ? "font-weight:700" : ""}">${val > 0 ? val : "—"}</td>`;
    }).join("");
    const mk = data.perDecKappa[hIdx];
    const kappaColor = isNaN(mk.kappa) ? "#999" : mk.kappa >= 0.6 ? "#16a34a" : mk.kappa >= 0.4 ? "#ca8a04" : mk.kappa >= 0.2 ? "#ea580c" : "#dc2626";
    return `<tr><td><span class="badge" style="background:${hCol.bg};color:${hCol.text}">${hDec}</span></td>` +
      `${cells}<td style="font-weight:600">${(mk.pctAgree * 100).toFixed(0)}%</td>` +
      `<td><span class="kappa-badge" style="color:${kappaColor}">${isNaN(mk.kappa) ? "N/A" : `${mk.kappa.toFixed(2)} · ${interpretKappa(mk.kappa)}`}</span></td></tr>`;
  }).join("");

  const disagRows = data.disagreements.map((d) => {
    const aiCol = EXPORT_COLORS[d.aiDecision] ?? { bg: "#f0f0f0", text: "#333", solid: "#999" };
    const huCol = EXPORT_COLORS[d.humanDecision] ?? { solid: "#999" };
    return `<tr><td>Row ${d.idx + 1}</td><td>${esc(d.title.slice(0, 80))}</td>` +
      `<td><span class="badge" style="background:${aiCol.bg};color:${aiCol.text}">${d.aiDecision} (${Math.round(d.aiConfidence * 100)}%)</span></td>` +
      `<td><span class="badge" style="background:${huCol.solid};color:white">${d.humanDecision}</span></td></tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Abstract Screener Analytics Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; font-size: 13px; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; margin-bottom: 0.5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.25rem; }
  .meta { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.75rem; margin-bottom: 1.5rem; }
  .kpi { border: 1px solid #e5e5e5; border-radius: 8px; padding: 0.75rem; }
  .kpi-value { font-size: 1.25rem; font-weight: 700; }
  .kpi-label { font-size: 0.75rem; color: #666; margin-top: 0.15rem; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
  th, td { border: 1px solid #e5e5e5; padding: 6px 10px; text-align: center; font-size: 12px; }
  th { background: #f9f9f9; font-weight: 600; font-size: 11px; color: #666; }
  td:first-child, th:first-child { text-align: left; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: capitalize; }
  .kappa-badge { font-size: 11px; font-weight: 600; }
  .progress-bar { display: flex; border-radius: 6px; overflow: hidden; margin: 8px 0; }
  .progress-legend { font-size: 11px; color: #666; margin-top: 4px; }
  .mosaic-wrap { margin: 1rem 0; }
  .mosaic-wrap svg { max-width: 100%; height: auto; }
  @media print { body { margin: 0; } .kpi-grid { grid-template-columns: repeat(3, 1fr); } }
</style></head><body>
<h1>Abstract Screener Analytics Report</h1>
<div class="meta">Generated ${new Date().toLocaleString()} · ${data.totalRows} rows</div>
<div class="kpi-grid">${kpiHtml}</div>

<h2>Screening Progress</h2>
<div style="font-size:12px;color:#666;margin-bottom:4px">${data.decidedCount}/${data.totalRows} (${data.totalRows > 0 ? Math.round((data.decidedCount / data.totalRows) * 100) : 0}%)</div>
<div class="progress-bar">${progressBarHtml}</div>
<div class="progress-legend">${progressLegend}</div>

<h2>Decision Metrics &amp; AI Agreement</h2>
<table>
  <thead><tr><th>Decision</th><th>AI Count</th><th>Human Count</th><th>Agreement</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead>
  <tbody>${statsRows}</tbody>
</table>

<h2>Inter-Rater Agreement Matrix</h2>
<table>
  <thead><tr><th>Human ↓ / AI →</th>${matrixHeader}<th>% Agree</th><th>Kappa</th></tr></thead>
  <tbody>${matrixRows}</tbody>
</table>

<h2>Mosaic Plot</h2>
<div class="mosaic-wrap">${data.mosaicSvg}</div>

${data.disagreements.length > 0 ? `
<h2>Disagreements (${data.disagreements.length})</h2>
<table>
  <thead><tr><th>Row</th><th>Title</th><th>AI Decision</th><th>Human Decision</th></tr></thead>
  <tbody>${disagRows}</tbody>
</table>` : ""}

</body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "screener-analytics-report.html";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Panel ────────────────────────────────────────────────────────

interface ScreenerAnalyticsPanelProps {
  data: Row[];
  decisions: Record<number, Decision>;
  aiResults: Record<number, AIScreenResult>;
  colMap: ColMap;
  onGoToRow?: (idx: number) => void;
}

export function ScreenerAnalyticsPanel({
  data,
  decisions,
  aiResults,
  colMap,
  onGoToRow,
}: ScreenerAnalyticsPanelProps) {
  const totalRows = data.length;
  const aiCount = Object.keys(aiResults).length;
  const mosaicSvgRef = useRef<SVGSVGElement | null>(null);

  const decidedEntries = Object.entries(decisions).filter(([, d]) => d != null) as [string, DecisionLabel][];
  const decidedCount = decidedEntries.length;
  const includeCount = decidedEntries.filter(([, d]) => d === "include").length;
  const excludeCount = decidedEntries.filter(([, d]) => d === "exclude").length;
  const maybeCount = decidedEntries.filter(([, d]) => d === "maybe").length;
  const undecidedCount = totalRows - decidedCount;

  // Build parallel vectors of human/AI decisions for rows with both
  const pairedRows = useMemo(() => {
    return decidedEntries
      .map(([i, dec]) => {
        const ai = aiResults[Number(i)];
        if (!ai) return null;
        return { idx: Number(i), human: dec, ai: ai.decision, aiConf: ai.confidence, aiProbs: ai.probabilities };
      })
      .filter(Boolean) as { idx: number; human: DecisionLabel; ai: DecisionLabel; aiConf: number; aiProbs: { include: number; maybe: number; exclude: number } }[];
  }, [decidedEntries, aiResults]);

  const agreementCount = pairedRows.filter((r) => r.human === r.ai).length;
  const agreementRate = pairedRows.length > 0
    ? ((agreementCount / pairedRows.length) * 100).toFixed(1)
    : "—";

  // Overall Kappa
  const overallKappa = useMemo(() => {
    if (pairedRows.length === 0) return NaN;
    return computeKappa(
      pairedRows.map((r) => r.human),
      pairedRows.map((r) => r.ai),
    );
  }, [pairedRows]);

  // Per-decision Precision / Recall / F1
  const decisionStats = useMemo(() => {
    return DECISION_LABELS.map((dec) => {
      const aiDec = pairedRows.filter((r) => r.ai === dec).length;
      const humanDec = pairedRows.filter((r) => r.human === dec).length;
      const tp = pairedRows.filter((r) => r.ai === dec && r.human === dec).length;

      const precisionNum = aiDec > 0 ? (tp / aiDec) * 100 : NaN;
      const recallNum = humanDec > 0 ? (tp / humanDec) * 100 : NaN;
      const precision = !isNaN(precisionNum) ? precisionNum.toFixed(0) : "—";
      const recall = !isNaN(recallNum) ? recallNum.toFixed(0) : "—";
      const f1Val = !isNaN(precisionNum) && !isNaN(recallNum) ? f1Score(precisionNum, recallNum).toFixed(0) : "—";

      return { decision: dec, aiCount: aiDec, humanCount: humanDec, tp, precision, recall, f1: f1Val };
    });
  }, [pairedRows]);

  // Overall F1 (macro-average)
  const overallF1 = useMemo(() => {
    const f1s = decisionStats
      .map((s) => (s.f1 !== "—" ? parseFloat(s.f1) : NaN))
      .filter((v) => !isNaN(v));
    return f1s.length > 0 ? (f1s.reduce((s, v) => s + v, 0) / f1s.length).toFixed(0) : "—";
  }, [decisionStats]);

  // 3×3 Agreement matrix
  const { matrix, colTotals, rowTotals, grandTotal } = useMemo(() => {
    const m = Array.from({ length: 3 }, () => Array(3).fill(0) as number[]);
    for (const r of pairedRows) {
      const hi = DECISION_LABELS.indexOf(r.human);
      const ai = DECISION_LABELS.indexOf(r.ai);
      if (hi >= 0 && ai >= 0) m[hi][ai]++;
    }
    const ct = [0, 1, 2].map((j) => m[0][j] + m[1][j] + m[2][j]);
    const rt = [0, 1, 2].map((i) => m[i][0] + m[i][1] + m[i][2]);
    const gt = ct.reduce((s, v) => s + v, 0);
    return { matrix: m, colTotals: ct, rowTotals: rt, grandTotal: gt };
  }, [pairedRows]);

  // Per-decision kappa (one-vs-rest)
  const perDecKappa = useMemo(() => {
    return DECISION_LABELS.map((dec) => {
      const humanBinary = pairedRows.map((r) => r.human === dec ? 1 : 0);
      const aiBinary = pairedRows.map((r) => r.ai === dec ? 1 : 0);
      const n = humanBinary.length;
      if (n === 0) return { pctAgree: 0, kappa: NaN };
      let agree = 0;
      for (let i = 0; i < n; i++) { if (humanBinary[i] === aiBinary[i]) agree++; }
      const pctAgree = agree / n;
      // Binary kappa
      const p1h = humanBinary.filter((v) => v === 1).length / n;
      const p1a = aiBinary.filter((v) => v === 1).length / n;
      const pe = p1h * p1a + (1 - p1h) * (1 - p1a);
      const kappa = pe === 1 ? 1 : (pctAgree - pe) / (1 - pe);
      return { pctAgree, kappa };
    });
  }, [pairedRows]);

  // Confidence distribution
  const confBuckets = useMemo(() => {
    const buckets = { low: 0, medium: 0, high: 0, veryHigh: 0 };
    Object.values(aiResults).forEach((r) => {
      const pct = r.confidence * 100;
      if (pct < 25) buckets.low++;
      else if (pct < 50) buckets.medium++;
      else if (pct < 75) buckets.high++;
      else buckets.veryHigh++;
    });
    return buckets;
  }, [aiResults]);

  // Decision distribution
  const decisionCounts = [
    { label: "Include", count: includeCount, color: "bg-green-500" },
    { label: "Exclude", count: excludeCount, color: "bg-red-500" },
    { label: "Maybe", count: maybeCount, color: "bg-amber-500" },
    { label: "Undecided", count: undecidedCount, color: "bg-gray-300" },
  ];

  // Disagreements
  const disagreements = useMemo(() => {
    return pairedRows
      .filter((r) => r.human !== r.ai)
      .map((r) => {
        const title = colMap.title && data[r.idx] ? String(data[r.idx][colMap.title] ?? "") : `Record ${r.idx + 1}`;
        return { idx: r.idx, title, aiDecision: r.ai, humanDecision: r.human, aiConfidence: r.aiConf };
      })
      .slice(0, 30);
  }, [pairedRows, data, colMap]);

  const handleExport = () => {
    const svgEl = mosaicSvgRef.current;
    const mosaicSvg = svgEl ? svgEl.outerHTML : "<p>No mosaic plot data</p>";
    exportAnalyticsHTML({
      totalRows, aiCount, decidedCount, includeCount, excludeCount, maybeCount,
      agreementRate: agreementRate === "—" ? "—" : agreementRate,
      overallKappa, overallF1,
      decisionStats, matrix, perDecKappa, disagreements, mosaicSvg,
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          Analytics
          <span className="text-sm font-normal text-muted-foreground">— {totalRows} rows</span>
        </h3>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={decidedCount === 0 && aiCount === 0}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export Analytics
        </Button>
      </div>

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Rows", value: String(totalRows), color: "text-foreground" },
          { label: "AI Processed", value: `${aiCount} (${totalRows > 0 ? Math.round((aiCount / totalRows) * 100) : 0}%)`, color: "text-orange-500" },
          { label: "Human Screened", value: String(decidedCount), color: "text-green-600" },
          { label: "AI Agreement", value: agreementRate === "—" ? "—" : `${agreementRate}%`, color: "text-blue-600" },
          { label: "Cohen's Kappa", value: isNaN(overallKappa) ? "N/A" : overallKappa.toFixed(2), color: overallKappa >= 0.6 ? "text-green-600" : overallKappa >= 0.4 ? "text-yellow-600" : "text-foreground", sub: interpretKappa(overallKappa) },
          { label: "Overall F1", value: overallF1 === "—" ? "—" : `${overallF1}%`, color: "text-purple-600" },
        ].map((stat) => (
          <div key={stat.label} className="border rounded-lg p-3">
            <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
            {"sub" in stat && stat.sub && (
              <div className="text-[10px] text-muted-foreground mt-0.5">{stat.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* Screening progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Screening progress</span>
          <span>{decidedCount}/{totalRows} ({totalRows > 0 ? Math.round((decidedCount / totalRows) * 100) : 0}%)</span>
        </div>
        <div className="w-full bg-muted rounded-full h-3 overflow-hidden flex">
          {decisionCounts.map((d) => (
            d.count > 0 ? (
              <div key={d.label} className={`${d.color} h-full transition-all`}
                style={{ width: `${totalRows > 0 ? (d.count / totalRows) * 100 : 0}%` }}
                title={`${d.label}: ${d.count}`} />
            ) : null
          ))}
        </div>
        <div className="flex gap-4 text-[10px] text-muted-foreground">
          {decisionCounts.filter((d) => d.count > 0).map((d) => (
            <span key={d.label} className="flex items-center gap-1">
              <span className={`inline-block w-2.5 h-2.5 rounded ${d.color}`} />
              {d.label} ({d.count})
            </span>
          ))}
        </div>
      </div>

      {/* Per-decision Precision / Recall / F1 table */}
      {pairedRows.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
            Decision Metrics &amp; AI Agreement
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2">Decision</th>
                  <th className="text-right px-3 py-2">AI Count</th>
                  <th className="text-right px-3 py-2">Human Count</th>
                  <th className="text-right px-3 py-2">Agreement</th>
                  <th className="text-right px-3 py-2">Precision</th>
                  <th className="text-right px-3 py-2">Recall</th>
                  <th className="text-right px-3 py-2">F1</th>
                </tr>
              </thead>
              <tbody>
                {decisionStats.map((s) => (
                  <tr key={s.decision} className="border-b hover:bg-muted/10">
                    <td className="px-4 py-2 font-medium capitalize">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                        style={{ backgroundColor: DECISION_COLORS[s.decision as DecisionLabel] }}>
                        {s.decision}
                      </span>
                    </td>
                    <td className="text-right px-3 py-2">{s.aiCount}</td>
                    <td className="text-right px-3 py-2">{s.humanCount}</td>
                    <td className="text-right px-3 py-2 font-medium">{s.tp}</td>
                    <td className="text-right px-3 py-2">{s.precision}{s.precision !== "—" ? "%" : ""}</td>
                    <td className="text-right px-3 py-2">{s.recall}{s.recall !== "—" ? "%" : ""}</td>
                    <td className="text-right px-3 py-2 font-medium">{s.f1}{s.f1 !== "—" ? "%" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI Confidence Distribution */}
      {aiCount > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
            AI Confidence Distribution ({aiCount} predictions)
          </div>
          <div className="p-4">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Low (0-25%)", count: confBuckets.low, color: "bg-red-100 text-red-700" },
                { label: "Medium (25-50%)", count: confBuckets.medium, color: "bg-amber-100 text-amber-700" },
                { label: "High (50-75%)", count: confBuckets.high, color: "bg-blue-100 text-blue-700" },
                { label: "Very High (75-100%)", count: confBuckets.veryHigh, color: "bg-green-100 text-green-700" },
              ].map((b) => (
                <div key={b.label} className={`rounded-lg p-3 ${b.color}`}>
                  <div className="text-xl font-bold">{b.count}</div>
                  <div className="text-xs mt-0.5 opacity-75">{b.label}</div>
                  <div className="text-xs opacity-60">
                    {aiCount > 0 ? Math.round((b.count / aiCount) * 100) : 0}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 3×3 Agreement Matrix with Kappa */}
      {pairedRows.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
            Inter-Rater Agreement Matrix
            <span className="text-xs font-normal text-muted-foreground ml-2">
              Human (rows) × AI (columns)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-3 py-2">Human ↓ / AI →</th>
                  {DECISION_LABELS.map((dec) => (
                    <th key={dec} className="text-center px-3 py-2">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium capitalize"
                        style={{ backgroundColor: DECISION_COLORS[dec] }}>
                        {dec}
                      </span>
                    </th>
                  ))}
                  <th className="text-right px-3 py-2">% Agree</th>
                  <th className="text-center px-3 py-2">Kappa</th>
                </tr>
              </thead>
              <tbody>
                {DECISION_LABELS.map((hDec, hIdx) => {
                  const pk = perDecKappa[hIdx];
                  return (
                    <tr key={hDec} className="border-b hover:bg-muted/10">
                      <td className="px-3 py-2">
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium capitalize"
                          style={{ backgroundColor: DECISION_COLORS[hDec] }}>
                          {hDec}
                        </span>
                      </td>
                      {DECISION_LABELS.map((aDec, aIdx) => {
                        const val = matrix[hIdx][aIdx];
                        const isDiag = hIdx === aIdx;
                        const maxCell = Math.max(...matrix.flat(), 1);
                        const opacity = val > 0 ? 0.15 + 0.85 * (val / maxCell) : 0;
                        return (
                          <td key={aDec} className="text-center px-3 py-2 text-xs"
                            style={{
                              backgroundColor: val > 0 ? hexToRgba(DECISION_COLORS[hDec], opacity) : undefined,
                              fontWeight: isDiag ? 600 : 400,
                            }}>
                            {val > 0 ? val : "—"}
                          </td>
                        );
                      })}
                      <td className="text-right px-3 py-2 text-xs font-medium">
                        {(pk.pctAgree * 100).toFixed(0)}%
                      </td>
                      <td className="text-center px-3 py-2">
                        <KappaBadge kappa={pk.kappa} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mosaic Plot */}
      {grandTotal > 0 && (
        <MosaicPlot
          matrix={matrix}
          colTotals={colTotals}
          rowTotals={rowTotals}
          grandTotal={grandTotal}
          svgRef={mosaicSvgRef}
        />
      )}

      {/* Disagreements */}
      {disagreements.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
            Disagreements — AI ≠ Human ({disagreements.length} rows)
          </div>
          <div className="divide-y max-h-72 overflow-y-auto">
            {disagreements.map((d) => (
              <div key={d.idx} className="px-4 py-2.5 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">Row {d.idx + 1}</div>
                  <div className="text-xs text-muted-foreground truncate">{d.title}</div>
                </div>
                <div className="shrink-0 flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded font-medium capitalize"
                    style={{ backgroundColor: DECISION_COLORS[d.aiDecision as DecisionLabel] }}>
                    AI: {d.aiDecision} ({Math.round(d.aiConfidence * 100)}%)
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className={`px-2 py-0.5 rounded font-medium capitalize ${
                    d.humanDecision === "include" ? "bg-green-500 text-white" :
                    d.humanDecision === "maybe" ? "bg-amber-500 text-white" : "bg-red-500 text-white"
                  }`}>
                    Human: {d.humanDecision}
                  </span>
                </div>
                {onGoToRow && (
                  <Button size="sm" variant="ghost" className="h-6 text-[11px] text-muted-foreground shrink-0"
                    onClick={() => onGoToRow(d.idx)}>
                    Go to row →
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
