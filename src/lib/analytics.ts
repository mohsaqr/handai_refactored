import type { AgreementMatrix } from "@/types";

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
  if (k < 0) return "Poor (< 0)";
  if (k < 0.2) return "Slight (0–0.20)";
  if (k < 0.4) return "Fair (0.21–0.40)";
  if (k < 0.6) return "Moderate (0.41–0.60)";
  if (k < 0.8) return "Substantial (0.61–0.80)";
  return "Almost Perfect (0.81–1.00)";
}
