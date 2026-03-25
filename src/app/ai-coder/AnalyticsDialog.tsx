"use client";

import React, { useState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download } from "lucide-react";
import type { CodeEntry } from "./ReviewPanel";
import {
  f1Score,
  weightedPerCodeKappa,
  weightedMultiLabelKappa,
  weightedPerCodePercentAgreement,
  weightedAgreementMatrix,
  interpretKappa,
} from "@/lib/analytics";

type Row = Record<string, unknown>;

const CODE_COLORS = [
  "#FFF3BF", "#C3FAE8", "#D0EBFF", "#F3D9FA",
  "#FFE8CC", "#FFDEEB", "#D3F9D8", "#E3FAFC",
];

function codeColor(code: string, allCodes: string[]): string {
  const idx = allCodes.indexOf(code);
  return CODE_COLORS[idx >= 0 ? idx % CODE_COLORS.length : 0];
}

function parseCodes(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "Uncoded");
}

/** Hex color to rgba with opacity */
function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

// ── KappaBadge ──────────────────────────────────────────────────────

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

// ── AgreementMatrixTable ────────────────────────────────────────────

function AgreementMatrixTable({
  allCodeLabels,
  aiCodesPerRow,
  humanCodesPerRow,
  aiConfNorm,
  humanWeightsPerRow,
}: {
  allCodeLabels: string[];
  aiCodesPerRow: string[][];
  humanCodesPerRow: string[][];
  aiConfNorm: Record<string, number>[];
  humanWeightsPerRow: Record<string, number>[];
}) {
  const n = aiConfNorm.length;

  const wm = useMemo(
    () => weightedAgreementMatrix(aiCodesPerRow, humanCodesPerRow, allCodeLabels, aiConfNorm, humanWeightsPerRow),
    [aiCodesPerRow, humanCodesPerRow, allCodeLabels, aiConfNorm, humanWeightsPerRow],
  );

  const maxCell = Math.max(...wm.matrix.flat(), 0.001);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
        Inter-Rater Agreement Matrix
        <span className="text-xs font-normal text-muted-foreground ml-2">
          Human Codes (rows) × AI Codes (columns) — doubly-weighted
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="text-left px-3 py-2">Human ↓ / AI →</th>
              {allCodeLabels.map((code) => (
                <th key={code} className="text-center px-2 py-2">
                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: codeColor(code, allCodeLabels) }}>
                    {code}
                  </span>
                </th>
              ))}
              <th className="text-right px-3 py-2">% Agree</th>
              <th className="text-center px-3 py-2">Kappa</th>
            </tr>
          </thead>
          <tbody>
            {allCodeLabels.map((hCode, hIdx) => {
              const aiVec = Array.from({ length: n }, (_, i) => aiConfNorm[i]?.[hCode] ?? 0);
              const huVec = Array.from({ length: n }, (_, i) => humanWeightsPerRow[i]?.[hCode] ?? 0);
              const pctAgree = weightedPerCodePercentAgreement(aiVec, huVec);
              const kappa = weightedPerCodeKappa(aiVec, huVec);
              return (
                <tr key={hCode} className="border-b hover:bg-muted/10">
                  <td className="px-3 py-2">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: codeColor(hCode, allCodeLabels) }}>
                      {hCode}
                    </span>
                  </td>
                  {allCodeLabels.map((aCode, aIdx) => {
                    const val = wm.matrix[hIdx][aIdx];
                    const opacity = val > 0 ? 0.15 + 0.85 * (val / maxCell) : 0;
                    const isDiag = hIdx === aIdx;
                    return (
                      <td
                        key={aCode}
                        className="text-center px-2 py-2 text-xs"
                        style={{
                          backgroundColor: val > 0 ? hexToRgba(codeColor(hCode, allCodeLabels), opacity) : undefined,
                          fontWeight: isDiag ? 600 : 400,
                        }}
                      >
                        {val > 0 ? val.toFixed(2) : "—"}
                      </td>
                    );
                  })}
                  <td className="text-right px-3 py-2 text-xs font-medium">
                    {(pctAgree * 100).toFixed(0)}%
                  </td>
                  <td className="text-center px-3 py-2">
                    <KappaBadge kappa={kappa} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── MosaicPlot ──────────────────────────────────────────────────────

function MosaicPlot({
  allCodeLabels,
  aiCodesPerRow,
  humanCodesPerRow,
  aiConfNorm,
  humanWeightsPerRow,
  svgRef,
}: {
  allCodeLabels: string[];
  aiCodesPerRow: string[][];
  humanCodesPerRow: string[][];
  aiConfNorm: Record<string, number>[];
  humanWeightsPerRow: Record<string, number>[];
  svgRef?: React.RefObject<SVGSVGElement | null>;
}) {
  const wm = useMemo(
    () => weightedAgreementMatrix(aiCodesPerRow, humanCodesPerRow, allCodeLabels, aiConfNorm, humanWeightsPerRow),
    [aiCodesPerRow, humanCodesPerRow, allCodeLabels, aiConfNorm, humanWeightsPerRow],
  );

  const [tooltip, setTooltip] = useState<{ x: number; y: number; human: string; ai: string; val: number; colPct: number; rowPct: number } | null>(null);

  if (wm.grandTotal === 0) {
    return (
      <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
        No overlap data to display. Both AI and human codes are needed.
      </div>
    );
  }

  const plotW = 600;
  const plotH = 400;
  const marginL = 90;
  const marginT = 50;
  const marginR = 10;
  const marginB = 10;
  const availW = plotW - marginL - marginR;
  const availH = plotH - marginT - marginB;
  const gap = 2;

  // Column widths (AI codes)
  const colWidths = allCodeLabels.map((_, j) =>
    wm.colTotals[j] > 0 ? (wm.colTotals[j] / wm.grandTotal) * availW : 0,
  );

  const rects: React.ReactNode[] = [];
  let colX = marginL;

  for (let j = 0; j < allCodeLabels.length; j++) {
    if (colWidths[j] <= 0) { colX += colWidths[j]; continue; }
    let cellY = marginT;
    const colTotal = wm.colTotals[j];

    for (let i = 0; i < allCodeLabels.length; i++) {
      const val = wm.matrix[i][j];
      if (val <= 0) continue;
      const cellH = (val / colTotal) * availH;
      const isDiag = i === j;
      const opacity = isDiag ? 0.85 : 0.15 + 0.7 * (val / colTotal);
      const color = codeColor(allCodeLabels[i], allCodeLabels);

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
              human: allCodeLabels[i],
              ai: allCodeLabels[j],
              val,
              colPct: colTotal > 0 ? (val / colTotal) * 100 : 0,
              rowPct: wm.rowTotals[i] > 0 ? (val / wm.rowTotals[i]) * 100 : 0,
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

  // X-axis labels (AI codes)
  const xLabels: React.ReactNode[] = [];
  let labelX = marginL;
  for (let j = 0; j < allCodeLabels.length; j++) {
    if (colWidths[j] > 0) {
      xLabels.push(
        <text
          key={`xl-${j}`}
          x={labelX + colWidths[j] / 2}
          y={marginT - 8}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          className="text-muted-foreground"
        >
          {allCodeLabels[j]}
        </text>,
      );
    }
    labelX += colWidths[j];
  }

  // Y-axis labels (Human codes) — positioned based on row totals
  const yLabels: React.ReactNode[] = [];
  let rowY = marginT;
  for (let i = 0; i < allCodeLabels.length; i++) {
    const rowH = wm.rowTotals[i] > 0 ? (wm.rowTotals[i] / wm.grandTotal) * availH : 0;
    if (rowH > 0) {
      yLabels.push(
        <text
          key={`yl-${i}`}
          x={marginL - 6}
          y={rowY + rowH / 2}
          textAnchor="end"
          dominantBaseline="central"
          fontSize={10}
          fill="currentColor"
          className="text-muted-foreground"
        >
          {allCodeLabels[i]}
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
          Column width = AI code frequency · Cell height = human code share · Opacity = agreement density
        </span>
      </div>
      <div className="p-4 relative">
        <svg ref={svgRef} viewBox={`0 0 ${plotW} ${plotH}`} className="w-full" style={{ maxHeight: 420 }}>
          {/* Axis titles */}
          <text x={plotW / 2} y={12} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor">AI Codes</text>
          <text x={12} y={plotH / 2} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor" transform={`rotate(-90, 12, ${plotH / 2})`}>Human Codes</text>
          {xLabels}
          {yLabels}
          {rects}
        </svg>
        {tooltip && (
          <div
            className="fixed z-50 bg-foreground text-background rounded-md px-3 py-2 text-xs pointer-events-none shadow-lg"
            style={{ left: tooltip.x + 14, top: tooltip.y - 32 }}
          >
            <div className="font-semibold mb-1">Human: {tooltip.human} × AI: {tooltip.ai}</div>
            <div>Weighted count: {tooltip.val.toFixed(2)}</div>
            <div>% of AI column: {tooltip.colPct.toFixed(1)}%</div>
            <div>% of Human row: {tooltip.rowPct.toFixed(1)}%</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Export Analytics as HTML Report ──────────────────────────────────

interface ExportData {
  totalRows: number;
  aiCount: number;
  humanCount: number;
  agreementRate: string;
  overallKappa: number;
  overallF1: string;
  codeStats: { code: string; aiSuggested: number; humanApplied: number; aiAccepted: number; precision: string; recall: string; f1: string }[];
  allCodeLabels: string[];
  matrixData: import("@/types").WeightedMatrix;
  matrixKappas: { pctAgree: number; kappa: number }[];
  disagreements: { idx: number; humanCodes: string[]; aiWithProb: { code: string; prob: number }[] }[];
  mosaicSvg: string;
}

function exportAnalyticsHTML(data: ExportData) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const kpiCards = [
    { label: "Total Rows", value: String(data.totalRows) },
    { label: "AI Processed", value: `${data.aiCount} (${data.totalRows > 0 ? Math.round((data.aiCount / data.totalRows) * 100) : 0}%)` },
    { label: "Human Reviewed", value: String(data.humanCount) },
    { label: "AI→Human Accept", value: `${data.agreementRate}%` },
    { label: "Weighted Kappa", value: isNaN(data.overallKappa) ? "N/A" : `${data.overallKappa.toFixed(2)} (${interpretKappa(data.overallKappa)})` },
    { label: "Overall F1", value: data.overallF1 === "—" ? "—" : `${data.overallF1}%` },
  ];

  const kpiHtml = kpiCards.map((k) =>
    `<div class="kpi"><div class="kpi-value">${esc(k.value)}</div><div class="kpi-label">${esc(k.label)}</div></div>`,
  ).join("");

  // Table 1: Per-code stats
  const statsRows = data.codeStats.map((s) =>
    `<tr><td><span class="badge" style="background:${codeColor(s.code, data.allCodeLabels)}">${esc(s.code)}</span></td>` +
    `<td>${s.aiSuggested.toFixed(2)}</td><td>${s.humanApplied.toFixed(2)}</td><td>${s.aiAccepted.toFixed(2)}</td>` +
    `<td>${s.precision}${s.precision !== "—" ? "%" : ""}</td><td>${s.recall}${s.recall !== "—" ? "%" : ""}</td>` +
    `<td>${s.f1}${s.f1 !== "—" ? "%" : ""}</td></tr>`,
  ).join("");

  // Table 2: Agreement matrix
  const matrixHeader = data.allCodeLabels.map((c) =>
    `<th><span class="badge" style="background:${codeColor(c, data.allCodeLabels)}">${esc(c)}</span></th>`,
  ).join("");
  const matrixRows = data.allCodeLabels.map((hCode, hIdx) => {
    const cells = data.allCodeLabels.map((_, aIdx) => {
      const val = data.matrixData.matrix[hIdx][aIdx];
      const maxCell = Math.max(...data.matrixData.matrix.flat(), 0.001);
      const opacity = val > 0 ? 0.15 + 0.85 * (val / maxCell) : 0;
      const bg = val > 0 ? hexToRgba(codeColor(hCode, data.allCodeLabels), opacity) : "transparent";
      return `<td style="background:${bg};${hIdx === aIdx ? "font-weight:600" : ""}">${val > 0 ? val.toFixed(2) : "—"}</td>`;
    }).join("");
    const mk = data.matrixKappas[hIdx];
    return `<tr><td><span class="badge" style="background:${codeColor(hCode, data.allCodeLabels)}">${esc(hCode)}</span></td>` +
      `${cells}<td>${(mk.pctAgree * 100).toFixed(0)}%</td>` +
      `<td>${isNaN(mk.kappa) ? "N/A" : `${mk.kappa.toFixed(2)} (${interpretKappa(mk.kappa)})`}</td></tr>`;
  }).join("");

  // Table 3: Disagreements
  const disagRows = data.disagreements.map((d) => {
    const humanBadges = d.humanCodes.map((c) =>
      `<span class="badge" style="background:${codeColor(c, data.allCodeLabels)}">${esc(c)}</span>`,
    ).join(" ");
    const aiBadges = d.aiWithProb.map(({ code: c, prob }) =>
      `<span class="badge ai" style="background:${codeColor(c, data.allCodeLabels)}50">${esc(c)} ${(prob * 100).toFixed(0)}%</span>`,
    ).join(" ");
    return `<tr><td>Row ${d.idx + 1}</td><td>${humanBadges}</td><td>${aiBadges}</td></tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>AI Coder Analytics Report</title>
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
  .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 500; }
  .badge.ai { border: 1px dashed #ccc; }
  .mosaic-wrap { margin: 1rem 0; }
  .mosaic-wrap svg { max-width: 100%; height: auto; }
  @media print { body { margin: 0; } .kpi-grid { grid-template-columns: repeat(3, 1fr); } }
</style></head><body>
<h1>AI Coder Analytics Report</h1>
<div class="meta">Generated ${new Date().toLocaleString()} · ${data.totalRows} rows · Probability-weighted metrics</div>
<div class="kpi-grid">${kpiHtml}</div>

<h2>Code Frequency &amp; AI Agreement</h2>
<table>
  <thead><tr><th>Code</th><th>AI Suggested</th><th>Human</th><th>Accepted</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead>
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
  <thead><tr><th>Row</th><th>Human</th><th>AI (with probabilities)</th></tr></thead>
  <tbody>${disagRows}</tbody>
</table>` : ""}

</body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "analytics-report.html";
  a.click();
  URL.revokeObjectURL(url);
}

// ── AnalyticsPanel ──────────────────────────────────────────────────

interface AnalyticsPanelProps {
  codebook: CodeEntry[];
  results: Row[];
  overrides: Record<number, string[]>;
  aiData: Record<number, { codes: string[]; confidence: Record<string, number> }>;
  onGoToRow?: (idx: number) => void;
}

export function AnalyticsPanel({
  codebook,
  results,
  overrides,
  aiData,
  onGoToRow,
}: AnalyticsPanelProps) {
  const allCodeLabels = codebook.map((c) => c.code);
  const totalRows = results.length;
  const hasOverrides = Object.keys(overrides).length > 0;
  const mosaicSvgRef = useRef<SVGSVGElement | null>(null);

  // Parse AI codes from results
  const aiCodesPerRow: string[][] = results.map((r) => parseCodes(String(r.ai_codes ?? "")));
  const humanCodesPerRow: string[][] = results.map((_, i) => overrides[i] ?? []);

  // Normalized AI confidence per row (0-100 → 0-1)
  const aiConfNorm: Record<string, number>[] = results.map((_, i) => {
    const raw = aiData[i]?.confidence ?? {};
    const norm: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      norm[k] = v / 100;
    }
    return norm;
  });

  // Human split weights per row: 1/N for each selected code
  const humanWeightsPerRow: Record<string, number>[] = results.map((_, i) => {
    const codes = overrides[i] ?? [];
    const w = codes.length > 0 ? 1 / codes.length : 0;
    return Object.fromEntries(codes.map((c) => [c, w]));
  });

  const aiCount = aiCodesPerRow.filter((c) => c.length > 0).length;
  const humanCount = Object.keys(overrides).filter((k) => (overrides[+k] ?? []).length > 0).length;

  // Per-code stats — WEIGHTED
  const codeStats = allCodeLabels.map((code) => {
    // AI Suggested = Σ normalized confidence for this code
    const aiSuggested = aiConfNorm.reduce((sum, conf) => sum + (conf[code] ?? 0), 0);
    // Human Applied = Σ split weights for this code
    const humanApplied = humanWeightsPerRow.reduce((sum, w) => sum + (w[code] ?? 0), 0);
    // Accepted = Σ min(aiConf, humanWeight)
    const aiAccepted = results.reduce((sum, _, i) => {
      const aiW = aiConfNorm[i][code] ?? 0;
      const huW = humanWeightsPerRow[i][code] ?? 0;
      return sum + Math.min(aiW, huW);
    }, 0);

    const precisionNum = aiSuggested > 0 ? (aiAccepted / aiSuggested) * 100 : NaN;
    const recallNum = humanApplied > 0 ? (aiAccepted / humanApplied) * 100 : NaN;
    const precision = !isNaN(precisionNum) ? precisionNum.toFixed(0) : "—";
    const recall = !isNaN(recallNum) ? recallNum.toFixed(0) : "—";
    const f1 = !isNaN(precisionNum) && !isNaN(recallNum) ? f1Score(precisionNum, recallNum).toFixed(0) : "—";

    return { code, aiSuggested, humanApplied, aiAccepted, precision, recall, f1 };
  });

  const totalAISuggested = codeStats.reduce((s, c) => s + c.aiSuggested, 0);
  const totalAIAccepted = codeStats.reduce((s, c) => s + c.aiAccepted, 0);
  const agreementRate = totalAISuggested > 0 ? ((totalAIAccepted / totalAISuggested) * 100).toFixed(1) : "—";

  // Overall KPIs — weighted
  const overallKappa = hasOverrides ? weightedMultiLabelKappa(aiConfNorm, humanWeightsPerRow, allCodeLabels) : NaN;
  const overallF1 = useMemo(() => {
    const f1s = codeStats
      .map((s) => (s.f1 !== "—" ? parseFloat(s.f1) : NaN))
      .filter((v) => !isNaN(v));
    return f1s.length > 0 ? (f1s.reduce((s, v) => s + v, 0) / f1s.length).toFixed(0) : "—";
  }, [codeStats]);

  // Disagreements — compare human's N codes against AI's top-N by probability
  const disagreements = results
    .map((_, i) => {
      const humanCodes = humanCodesPerRow[i];
      if (humanCodes.length === 0) return null;
      const n = humanCodes.length;
      const conf = aiConfNorm[i] ?? {};
      // AI's top-N codes sorted by confidence descending
      const aiSorted = Object.entries(conf)
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a);
      const aiTopN = new Set(aiSorted.slice(0, n).map(([k]) => k));
      const humanSet = new Set(humanCodes);
      const onlyAI = [...aiTopN].filter((c) => !humanSet.has(c));
      const onlyHuman = [...humanSet].filter((c) => !aiTopN.has(c));
      if (onlyAI.length === 0 && onlyHuman.length === 0) return null;
      // Full context: all human codes + all AI codes with probabilities
      const aiWithProb = aiSorted.map(([code, prob]) => ({ code, prob }));
      return { idx: i, onlyAI, onlyHuman, humanCodes, aiWithProb };
    })
    .filter(Boolean)
    .slice(0, 15);

  // Pre-compute matrix data for export
  const matrixData = useMemo(
    () => weightedAgreementMatrix(aiCodesPerRow, humanCodesPerRow, allCodeLabels, aiConfNorm, humanWeightsPerRow),
    [aiCodesPerRow, humanCodesPerRow, allCodeLabels, aiConfNorm, humanWeightsPerRow],
  );
  const matrixKappas = useMemo(() => {
    const n = aiConfNorm.length;
    return allCodeLabels.map((code) => {
      const aiVec = Array.from({ length: n }, (_, i) => aiConfNorm[i]?.[code] ?? 0);
      const huVec = Array.from({ length: n }, (_, i) => humanWeightsPerRow[i]?.[code] ?? 0);
      return { pctAgree: weightedPerCodePercentAgreement(aiVec, huVec), kappa: weightedPerCodeKappa(aiVec, huVec) };
    });
  }, [aiConfNorm, humanWeightsPerRow, allCodeLabels]);

  const handleExport = () => {
    const svgEl = mosaicSvgRef.current;
    const mosaicSvg = svgEl ? svgEl.outerHTML : "<p>No mosaic plot data</p>";
    exportAnalyticsHTML({
      totalRows, aiCount, humanCount, agreementRate, overallKappa, overallF1,
      codeStats, allCodeLabels, matrixData, matrixKappas,
      disagreements: disagreements.filter((d): d is NonNullable<typeof d> => d !== null),
      mosaicSvg,
    });
  };

  return (
    <div className="space-y-4">
      {/* Header — title left, export button right */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          Analytics
          <span className="text-sm font-normal text-muted-foreground">
            — {totalRows} rows
          </span>
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={codeStats.length === 0}
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export Analytics
        </Button>
      </div>

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Rows", value: String(totalRows), color: "text-foreground" },
          { label: "AI Processed", value: `${aiCount} (${totalRows > 0 ? Math.round((aiCount / totalRows) * 100) : 0}%)`, color: "text-orange-500" },
          { label: "Human Reviewed", value: `${humanCount}`, color: "text-green-600" },
          { label: "AI→Human Accept", value: `${agreementRate}%`, color: "text-blue-600" },
          { label: "Weighted Kappa", value: isNaN(overallKappa) ? "N/A" : overallKappa.toFixed(2), color: overallKappa >= 0.6 ? "text-green-600" : overallKappa >= 0.4 ? "text-yellow-600" : "text-foreground", sub: interpretKappa(overallKappa) },
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

      {/* Per-code table */}
      {codeStats.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
            Code Frequency &amp; AI Agreement
            <span className="text-xs font-normal text-muted-foreground ml-2">
              — probability-weighted
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2">Code</th>
                  <th className="text-right px-4 py-2">AI Suggested</th>
                  {hasOverrides && <th className="text-right px-4 py-2">Human</th>}
                  {hasOverrides && <th className="text-right px-4 py-2">Accepted</th>}
                  {hasOverrides && <th className="text-right px-4 py-2">Precision</th>}
                  {hasOverrides && <th className="text-right px-4 py-2">Recall</th>}
                  {hasOverrides && <th className="text-right px-4 py-2">F1</th>}
                  <th className="px-4 py-2">Distribution</th>
                </tr>
              </thead>
              <tbody>
                {codeStats.map(({ code, aiSuggested, humanApplied, aiAccepted, precision, recall, f1 }) => {
                  const color = codeColor(code, allCodeLabels);
                  // Distribution bar: weighted AI suggested as % of total weighted
                  const pct = totalAISuggested > 0 ? (aiSuggested / totalAISuggested) * 100 : 0;
                  return (
                    <tr key={code} className="border-b hover:bg-muted/10">
                      <td className="px-4 py-2">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: color }}>{code}</span>
                      </td>
                      <td className="text-right px-4 py-2 text-xs text-orange-500">{aiSuggested.toFixed(2)}</td>
                      {hasOverrides && <td className="text-right px-4 py-2 text-xs">{humanApplied.toFixed(2)}</td>}
                      {hasOverrides && <td className="text-right px-4 py-2 text-xs text-blue-600">{aiAccepted.toFixed(2)}</td>}
                      {hasOverrides && <td className="text-right px-4 py-2 text-xs">{precision}{precision !== "—" ? "%" : ""}</td>}
                      {hasOverrides && <td className="text-right px-4 py-2 text-xs">{recall}{recall !== "—" ? "%" : ""}</td>}
                      {hasOverrides && <td className="text-right px-4 py-2 text-xs font-medium">{f1}{f1 !== "—" ? "%" : ""}</td>}
                      <td className="px-4 py-2 w-32">
                        <div className="bg-muted rounded h-4 overflow-hidden">
                          <div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Agreement Matrix */}
      {hasOverrides && (
        <AgreementMatrixTable
          allCodeLabels={allCodeLabels}
          aiCodesPerRow={aiCodesPerRow}
          humanCodesPerRow={humanCodesPerRow}
          aiConfNorm={aiConfNorm}
          humanWeightsPerRow={humanWeightsPerRow}
        />
      )}

      {/* Mosaic Plot */}
      {hasOverrides && (
        <MosaicPlot
          allCodeLabels={allCodeLabels}
          aiCodesPerRow={aiCodesPerRow}
          humanCodesPerRow={humanCodesPerRow}
          aiConfNorm={aiConfNorm}
          humanWeightsPerRow={humanWeightsPerRow}
          svgRef={mosaicSvgRef}
        />
      )}

      {/* Disagreements */}
      {disagreements.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
            Disagreements ({disagreements.length} shown)
          </div>
          <div className="divide-y max-h-60 overflow-y-auto">
            {disagreements.map((d) => {
              if (!d) return null;
              const row = results[d.idx];
              const preview = Object.values(row).map(String).join(" · ").slice(0, 100);
              return (
                <div key={d.idx} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium mb-0.5">Row {d.idx + 1}</div>
                      <div className="text-xs text-muted-foreground truncate">{preview}…</div>
                    </div>
                    <div className="shrink-0 text-xs space-y-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-green-600 font-medium">Human:</span>
                        {d.humanCodes.map((c) => (
                          <span key={c} className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: codeColor(c, allCodeLabels) }}>{c}</span>
                        ))}
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-orange-500 font-medium">AI:</span>
                        {d.aiWithProb.map(({ code: c, prob }) => (
                          <span key={c} className="px-1.5 py-0.5 rounded text-[10px] border border-dashed" style={{ backgroundColor: codeColor(c, allCodeLabels) + "50" }}>
                            {c} <span className="text-muted-foreground">{(prob * 100).toFixed(0)}%</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  {onGoToRow && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-0.5 h-6 text-[11px] text-muted-foreground"
                      onClick={() => onGoToRow(d.idx)}
                    >
                      Go to row →
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AnalyticsDialog ─────────────────────────────────────────────────

interface AnalyticsDialogProps extends AnalyticsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AnalyticsDialog({
  open,
  onOpenChange,
  ...panelProps
}: AnalyticsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] w-[100vw] max-h-[100vh] h-[100vh] overflow-y-auto rounded-none">
        <DialogHeader>
          <DialogTitle className="sr-only">Analytics</DialogTitle>
        </DialogHeader>
        <AnalyticsPanel {...panelProps} />
      </DialogContent>
    </Dialog>
  );
}
