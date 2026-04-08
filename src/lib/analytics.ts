import type { AgreementMatrix, WeightedMatrix } from "@/types";

/**
 * Cohen's Kappa for two annotators.
 * Both arrays must have the same length.
 * Returns NaN when kappa is undefined (e.g. only one category observed).
 */
export function cohenKappa(a: string[], b: string[]): number {
  if (a.length !== b.length || a.length === 0) return NaN;

  const n = a.length;

  // Observed agreement
  const po = a.filter((v, i) => v === b[i]).length / n;

  // Collect all unique categories
  const categories = [...new Set([...a, ...b])];

  // Expected agreement
  let pe = 0;
  for (const cat of categories) {
    const pA = a.filter((v) => v === cat).length / n;
    const pB = b.filter((v) => v === cat).length / n;
    pe += pA * pB;
  }

  if (pe === 1) return NaN; // degenerate case
  return (po - pe) / (1 - pe);
}

/**
 * Pairwise agreement matrix for N annotators.
 * outputs[i] is the array of labels from annotator i.
 */
export function pairwiseAgreement(outputs: string[][]): AgreementMatrix {
  const n = outputs.length;
  const pairLabels: string[] = [];
  const pairAgreements: number[] = [];
  const values: number[][] = Array.from({ length: n }, () => new Array(n).fill(1));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const kappa = cohenKappa(outputs[i], outputs[j]);
      pairLabels.push(`W${i + 1}–W${j + 1}`);
      pairAgreements.push(kappa);
      values[i][j] = kappa;
      values[j][i] = kappa;
    }
  }

  return {
    labels: outputs.map((_, i) => `Worker ${i + 1}`),
    values,
    pairLabels,
    pairAgreements,
  };
}

/**
 * Exact match rate: proportion of rows where all annotators agree.
 */
export function exactMatchRate(a: string[], b: string[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  return a.filter((v, i) => v === b[i]).length / a.length;
}

/**
 * Human-readable interpretation of Cohen's Kappa.
 * Based on Landis & Koch (1977) benchmarks.
 */
export function interpretKappa(k: number): string {
  if (isNaN(k)) return "N/A";
  if (k < 0.2) return "Very Low (0–0.19)";
  if (k < 0.4) return "Low (0.20–0.39)";
  if (k < 0.6) return "Moderate (0.40–0.59)";
  if (k < 0.8) return "High (0.60–0.79)";
  return "Very High (0.80–1.00)";
}

/**
 * Average pairwise agreement across all workers using set-based Jaccard similarity.
 *
 * Each worker output is tokenized into a set of codes (split by comma/newline).
 * For free-form text, the entire output is treated as a single token.
 * Agreement = |intersection| / |union| (Jaccard index), averaged across all pairs.
 * Returns a value in [0, 1]: 0 = no overlap, 1 = identical sets.
 */
export function multiWorkerKappa(workerOutputs: string[]): number {
  if (workerOutputs.length < 2) return NaN;

  // Tokenize each worker's output into a normalized set
  const workerSets = workerOutputs.map((output) => {
    const tokens = output.split(/[,\n]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    return new Set(tokens.length > 0 ? tokens : [output.trim().toLowerCase()]);
  });

  // Average pairwise Jaccard similarity
  const pairScores: number[] = [];
  for (let i = 0; i < workerSets.length; i++) {
    for (let j = i + 1; j < workerSets.length; j++) {
      const setA = workerSets[i];
      const setB = workerSets[j];
      let intersection = 0;
      for (const code of setA) {
        if (setB.has(code)) intersection++;
      }
      const union = new Set([...setA, ...setB]).size;
      pairScores.push(union === 0 ? 1 : intersection / union);
    }
  }

  if (pairScores.length === 0) return NaN;
  return pairScores.reduce((sum, s) => sum + s, 0) / pairScores.length;
}

// ── AI Coder IRA utilities ──────────────────────────────────────────

/**
 * F1-Score (harmonic mean of precision and recall).
 * Both values should be in [0,100] (percentages). Returns percentage.
 */
export function f1Score(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Per-code Cohen's Kappa for multi-label coding.
 * Converts multi-label arrays to binary presence/absence for `code`,
 * then computes standard Cohen's Kappa.
 */
export function perCodeKappa(
  aiCodes: string[][],
  humanCodes: string[][],
  code: string,
): number {
  const n = aiCodes.length;
  if (n === 0 || n !== humanCodes.length) return NaN;
  const a = aiCodes.map((codes) => (codes.includes(code) ? "1" : "0"));
  const b = humanCodes.map((codes) => (codes.includes(code) ? "1" : "0"));
  return cohenKappa(a, b);
}

/**
 * Pooled (macro-average) Cohen's Kappa across all codes.
 * Averages per-code kappas, skipping NaN values.
 */
export function multiLabelKappa(
  aiCodes: string[][],
  humanCodes: string[][],
  allCodes: string[],
): number {
  const kappas = allCodes
    .map((code) => perCodeKappa(aiCodes, humanCodes, code))
    .filter((k) => !isNaN(k));
  if (kappas.length === 0) return NaN;
  return kappas.reduce((sum, k) => sum + k, 0) / kappas.length;
}

/**
 * Percent agreement for a single code (binary presence/absence).
 * Returns proportion [0,1] of rows where AI and human agree.
 */
export function perCodePercentAgreement(
  aiCodes: string[][],
  humanCodes: string[][],
  code: string,
): number {
  const n = aiCodes.length;
  if (n === 0 || n !== humanCodes.length) return 0;
  let agree = 0;
  for (let i = 0; i < n; i++) {
    const aiHas = aiCodes[i].includes(code);
    const humanHas = humanCodes[i].includes(code);
    if (aiHas === humanHas) agree++;
  }
  return agree / n;
}

/**
 * Weighted kappa for continuous [0,1] rating vectors (Lin's CCC variant).
 * κ_w = 1 - mean((a-b)²) / (var(a) + var(b) + (μa-μb)²)
 * Returns NaN when degenerate (all values identical).
 */
export function weightedPerCodeKappa(
  aiWeights: number[],
  humanWeights: number[],
): number {
  const n = aiWeights.length;
  if (n === 0 || n !== humanWeights.length) return NaN;

  const meanA = aiWeights.reduce((s, v) => s + v, 0) / n;
  const meanB = humanWeights.reduce((s, v) => s + v, 0) / n;

  let varA = 0;
  let varB = 0;
  let obsDis = 0;
  for (let i = 0; i < n; i++) {
    varA += (aiWeights[i] - meanA) ** 2;
    varB += (humanWeights[i] - meanB) ** 2;
    obsDis += (aiWeights[i] - humanWeights[i]) ** 2;
  }
  varA /= n;
  varB /= n;
  obsDis /= n;

  const expDis = varA + varB + (meanA - meanB) ** 2;
  if (expDis === 0) return NaN;
  return 1 - obsDis / expDis;
}

/**
 * Macro-average weighted kappa across all codes.
 * For each code, extracts the per-row weight vectors from the maps,
 * computes weightedPerCodeKappa, then averages (skipping NaN).
 */
export function weightedMultiLabelKappa(
  aiConfidence: Record<string, number>[],
  humanWeights: Record<string, number>[],
  allCodes: string[],
): number {
  const n = aiConfidence.length;
  const kappas = allCodes
    .map((code) => {
      const aiVec = Array.from({ length: n }, (_, i) => aiConfidence[i]?.[code] ?? 0);
      const huVec = Array.from({ length: n }, (_, i) => humanWeights[i]?.[code] ?? 0);
      return weightedPerCodeKappa(aiVec, huVec);
    })
    .filter((k) => !isNaN(k));
  if (kappas.length === 0) return NaN;
  return kappas.reduce((sum, k) => sum + k, 0) / kappas.length;
}

/**
 * Continuous percent agreement for [0,1] weight vectors.
 * Returns 1 - mean(|a_i - b_i|).
 */
export function weightedPerCodePercentAgreement(
  aiWeights: number[],
  humanWeights: number[],
): number {
  const n = aiWeights.length;
  if (n === 0 || n !== humanWeights.length) return 0;
  let totalDiff = 0;
  for (let i = 0; i < n; i++) {
    totalDiff += Math.abs(aiWeights[i] - humanWeights[i]);
  }
  return 1 - totalDiff / n;
}

/**
 * Doubly-weighted agreement matrix (cross-tabulation).
 * Rows = human codes, columns = AI codes.
 * Cell [h][a] accumulates humanSplitWeight × aiConfidence.
 */
export function weightedAgreementMatrix(
  aiCodes: string[][],
  humanCodes: string[][],
  allCodes: string[],
  aiConfidence: Record<string, number>[],
  humanWeights: Record<string, number>[],
): WeightedMatrix {
  const k = allCodes.length;
  const matrix: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));

  for (let i = 0; i < aiCodes.length; i++) {
    const human = humanCodes[i] ?? [];
    const conf = aiConfidence[i] ?? {};
    const hWeights = humanWeights[i] ?? {};
    for (const hCode of human) {
      const hIdx = allCodes.indexOf(hCode);
      if (hIdx < 0) continue;
      const hW = hWeights[hCode] ?? 1.0;
      for (const aCode of aiCodes[i]) {
        const aIdx = allCodes.indexOf(aCode);
        if (aIdx < 0) continue;
        matrix[hIdx][aIdx] += hW * (conf[aCode] ?? 1.0);
      }
    }
  }

  const rowTotals = matrix.map((row) => row.reduce((s, v) => s + v, 0));
  const colTotals = allCodes.map((_, j) => matrix.reduce((s, row) => s + row[j], 0));
  const grandTotal = rowTotals.reduce((s, v) => s + v, 0);

  return {
    matrix,
    rowTotals,
    colTotals,
    grandTotal,
    rowLabels: [...allCodes],
    colLabels: [...allCodes],
  };
}
