import { describe, it, expect } from 'vitest';
import {
  cohenKappa,
  pairwiseAgreement,
  exactMatchRate,
  interpretKappa,
  f1Score,
  perCodeKappa,
  multiLabelKappa,
  perCodePercentAgreement,
  weightedAgreementMatrix,
  weightedPerCodeKappa,
  weightedMultiLabelKappa,
  weightedPerCodePercentAgreement,
} from '../analytics';

describe('cohenKappa', () => {
  it('returns 1.0 for perfect agreement', () => {
    expect(cohenKappa(['A', 'A', 'B', 'B'], ['A', 'A', 'B', 'B'])).toBeCloseTo(1.0);
  });

  it('returns -1.0 for perfect disagreement with balanced labels', () => {
    expect(cohenKappa(['A', 'B', 'A', 'B'], ['B', 'A', 'B', 'A'])).toBeCloseTo(-1.0);
  });

  it('returns 0.5 for partial agreement', () => {
    // po = 0.75, pe = 0.5 → kappa = (0.75 - 0.5) / 0.5 = 0.5
    expect(cohenKappa(['A', 'A', 'A', 'B'], ['A', 'A', 'B', 'B'])).toBeCloseTo(0.5);
  });

  it('returns NaN for empty arrays', () => {
    expect(cohenKappa([], [])).toBeNaN();
  });

  it('returns NaN for arrays of different lengths', () => {
    expect(cohenKappa(['A', 'B'], ['A'])).toBeNaN();
  });

  it('returns NaN when all labels are the same (degenerate: pe = 1)', () => {
    expect(cohenKappa(['A', 'A', 'A'], ['A', 'A', 'A'])).toBeNaN();
  });
});

describe('interpretKappa', () => {
  it('returns N/A for NaN', () => {
    expect(interpretKappa(NaN)).toBe('N/A');
  });

  it('returns Poor for negative kappa', () => {
    expect(interpretKappa(-0.1)).toBe('Poor (< 0)');
  });

  it('returns Slight for k in [0, 0.20)', () => {
    expect(interpretKappa(0.0)).toBe('Slight (0–0.20)');
    expect(interpretKappa(0.19)).toBe('Slight (0–0.20)');
  });

  it('returns Fair for k in [0.20, 0.40)', () => {
    expect(interpretKappa(0.2)).toBe('Fair (0.21–0.40)');
    expect(interpretKappa(0.39)).toBe('Fair (0.21–0.40)');
  });

  it('returns Moderate for k in [0.40, 0.60)', () => {
    expect(interpretKappa(0.4)).toBe('Moderate (0.41–0.60)');
    expect(interpretKappa(0.59)).toBe('Moderate (0.41–0.60)');
  });

  it('returns Substantial for k in [0.60, 0.80)', () => {
    expect(interpretKappa(0.6)).toBe('Substantial (0.61–0.80)');
    expect(interpretKappa(0.79)).toBe('Substantial (0.61–0.80)');
  });

  it('returns Almost Perfect for k >= 0.80', () => {
    expect(interpretKappa(0.8)).toBe('Almost Perfect (0.81–1.00)');
    expect(interpretKappa(1.0)).toBe('Almost Perfect (0.81–1.00)');
  });
});

describe('exactMatchRate', () => {
  it('returns 1.0 when all items match', () => {
    expect(exactMatchRate(['A', 'B', 'C'], ['A', 'B', 'C'])).toBeCloseTo(1.0);
  });

  it('returns 0.0 when no items match', () => {
    expect(exactMatchRate(['A', 'B'], ['C', 'D'])).toBeCloseTo(0.0);
  });

  it('returns 0.5 when half the items match', () => {
    expect(exactMatchRate(['A', 'B', 'C', 'D'], ['A', 'X', 'C', 'Y'])).toBeCloseTo(0.5);
  });

  it('returns 0 for empty arrays', () => {
    expect(exactMatchRate([], [])).toBe(0);
  });

  it('returns 0 for arrays of different lengths', () => {
    expect(exactMatchRate(['A', 'B'], ['A'])).toBe(0);
  });
});

describe('pairwiseAgreement', () => {
  it('produces one pair label for two annotators', () => {
    const matrix = pairwiseAgreement([['A', 'B', 'A'], ['A', 'B', 'B']]);
    expect(matrix.pairLabels).toHaveLength(1);
    expect(matrix.pairLabels[0]).toBe('W1–W2');
  });

  it('produces three pair labels for three annotators', () => {
    const matrix = pairwiseAgreement([['A', 'B'], ['A', 'A'], ['B', 'B']]);
    expect(matrix.pairLabels).toEqual(['W1–W2', 'W1–W3', 'W2–W3']);
  });

  it('diagonal values are 1', () => {
    const matrix = pairwiseAgreement([['A', 'B'], ['A', 'A']]);
    expect(matrix.values[0][0]).toBe(1);
    expect(matrix.values[1][1]).toBe(1);
  });

  it('matrix is symmetric', () => {
    const matrix = pairwiseAgreement([['A', 'B', 'A'], ['A', 'A', 'B'], ['B', 'B', 'A']]);
    expect(matrix.values[0][1]).toBeCloseTo(matrix.values[1][0]);
    expect(matrix.values[0][2]).toBeCloseTo(matrix.values[2][0]);
    expect(matrix.values[1][2]).toBeCloseTo(matrix.values[2][1]);
  });

  it('returns correct worker labels', () => {
    const matrix = pairwiseAgreement([['A'], ['B'], ['C']]);
    expect(matrix.labels).toEqual(['Worker 1', 'Worker 2', 'Worker 3']);
  });
});

// ── AI Coder IRA utilities ──────────────────────────────────────────

describe('f1Score', () => {
  it('returns 0 when both precision and recall are 0', () => {
    expect(f1Score(0, 0)).toBe(0);
  });

  it('returns correct value for known inputs', () => {
    // F1 = 2*80*60 / (80+60) = 9600/140 ≈ 68.57
    expect(f1Score(80, 60)).toBeCloseTo(68.57, 1);
  });

  it('returns 100 for perfect precision and recall', () => {
    expect(f1Score(100, 100)).toBeCloseTo(100);
  });

  it('returns 0 when one value is 0', () => {
    expect(f1Score(100, 0)).toBe(0);
    expect(f1Score(0, 50)).toBe(0);
  });
});

describe('perCodeKappa', () => {
  it('returns 1.0 when AI and human always agree', () => {
    const ai = [['A'], ['B'], ['A'], ['B']];
    const hu = [['A'], ['B'], ['A'], ['B']];
    expect(perCodeKappa(ai, hu, 'A')).toBeCloseTo(1.0);
  });

  it('returns negative for systematic disagreement', () => {
    // AI says A when human doesn't, and vice versa
    const ai = [['A'], [], ['A'], []];
    const hu = [[], ['A'], [], ['A']];
    expect(perCodeKappa(ai, hu, 'A')).toBeCloseTo(-1.0);
  });

  it('returns NaN when code never appears in either rater', () => {
    const ai = [['A'], ['A']];
    const hu = [['A'], ['A']];
    expect(perCodeKappa(ai, hu, 'Z')).toBeNaN();
  });

  it('handles multi-label rows', () => {
    const ai = [['A', 'B'], ['B'], ['A']];
    const hu = [['A', 'B'], ['B'], ['A']];
    expect(perCodeKappa(ai, hu, 'A')).toBeCloseTo(1.0);
    expect(perCodeKappa(ai, hu, 'B')).toBeCloseTo(1.0);
  });

  it('returns NaN for empty arrays', () => {
    expect(perCodeKappa([], [], 'A')).toBeNaN();
  });
});

describe('multiLabelKappa', () => {
  it('returns 1.0 for identical multi-label arrays', () => {
    const ai = [['A', 'B'], ['B'], ['A']];
    const hu = [['A', 'B'], ['B'], ['A']];
    expect(multiLabelKappa(ai, hu, ['A', 'B'])).toBeCloseTo(1.0);
  });

  it('returns expected value for partial agreement', () => {
    const ai = [['A'], ['B'], ['A'], ['B']];
    const hu = [['A'], ['A'], ['B'], ['B']];
    const k = multiLabelKappa(ai, hu, ['A', 'B']);
    // Should be 0 (random-level agreement for balanced 2-category case)
    expect(k).toBeCloseTo(0, 0);
  });

  it('returns NaN when no valid per-code kappas', () => {
    const ai = [['A'], ['A']];
    const hu = [['A'], ['A']];
    // Code A always present → degenerate, code B never present → NaN
    expect(multiLabelKappa(ai, hu, ['A'])).toBeNaN();
  });
});

describe('perCodePercentAgreement', () => {
  it('returns 1.0 for perfect agreement', () => {
    const ai = [['A'], ['B'], ['A']];
    const hu = [['A'], ['B'], ['A']];
    expect(perCodePercentAgreement(ai, hu, 'A')).toBeCloseTo(1.0);
  });

  it('returns 0.5 for half agreement', () => {
    const ai = [['A'], [], ['A'], []];
    const hu = [['A'], ['A'], [], []];
    // Row 0: both have A ✓, Row 1: only human ✗, Row 2: only AI ✗, Row 3: neither ✓ → 2/4
    expect(perCodePercentAgreement(ai, hu, 'A')).toBeCloseTo(0.5);
  });

  it('returns 1.0 when code is absent from both', () => {
    const ai = [['A'], ['A']];
    const hu = [['A'], ['A']];
    expect(perCodePercentAgreement(ai, hu, 'Z')).toBeCloseTo(1.0);
  });

  it('returns 0 for empty arrays', () => {
    expect(perCodePercentAgreement([], [], 'A')).toBe(0);
  });
});

describe('weightedAgreementMatrix (doubly-weighted)', () => {
  const allCodes = ['A', 'B'];

  it('produces correct matrix dimensions', () => {
    const wm = weightedAgreementMatrix([['A']], [['A']], allCodes, [{ A: 0.8 }], [{ A: 1.0 }]);
    expect(wm.matrix).toHaveLength(2);
    expect(wm.matrix[0]).toHaveLength(2);
  });

  it('doubly-weights cells by humanWeight × aiConfidence', () => {
    // human=A (split weight 1.0), AI=A with conf 0.8 → matrix[A][A] = 1.0 * 0.8 = 0.8
    const wm = weightedAgreementMatrix(
      [['A']],
      [['A']],
      allCodes,
      [{ A: 0.8 }],
      [{ A: 1.0 }],
    );
    expect(wm.matrix[0][0]).toBeCloseTo(0.8);
    expect(wm.matrix[0][1]).toBe(0);
  });

  it('applies human split weights correctly', () => {
    // human selects A and B (each 0.5), AI suggests A with conf 0.9
    // matrix[A][A] = 0.5 * 0.9 = 0.45
    // matrix[B][A] = 0.5 * 0.9 = 0.45
    const wm = weightedAgreementMatrix(
      [['A']],
      [['A', 'B']],
      allCodes,
      [{ A: 0.9 }],
      [{ A: 0.5, B: 0.5 }],
    );
    expect(wm.matrix[0][0]).toBeCloseTo(0.45); // A×A
    expect(wm.matrix[1][0]).toBeCloseTo(0.45); // B×A
  });

  it('row and column totals sum correctly', () => {
    const wm = weightedAgreementMatrix(
      [['A', 'B'], ['A']],
      [['A'], ['B']],
      allCodes,
      [{ A: 0.6, B: 0.4 }, { A: 0.9 }],
      [{ A: 1.0 }, { B: 1.0 }],
    );
    for (let i = 0; i < allCodes.length; i++) {
      const rowSum = wm.matrix[i].reduce((s, v) => s + v, 0);
      expect(wm.rowTotals[i]).toBeCloseTo(rowSum);
    }
    expect(wm.grandTotal).toBeCloseTo(wm.rowTotals.reduce((s, v) => s + v, 0));
  });

  it('handles rows with no AI suggestions', () => {
    const wm = weightedAgreementMatrix([[]],  [['A']], allCodes, [{}], [{ A: 1.0 }]);
    expect(wm.grandTotal).toBe(0);
  });

  it('handles rows with no human codes', () => {
    const wm = weightedAgreementMatrix([['A']], [[]], allCodes, [{ A: 0.9 }], [{}]);
    expect(wm.grandTotal).toBe(0);
  });

  it('defaults missing confidence to 1.0', () => {
    const wm = weightedAgreementMatrix([['A']], [['A']], allCodes, [{}], [{ A: 1.0 }]);
    expect(wm.matrix[0][0]).toBeCloseTo(1.0);
  });
});

// ── Weighted continuous IRA utilities ────────────────────────────────

describe('weightedPerCodeKappa', () => {
  it('returns 1.0 for identical continuous vectors', () => {
    expect(weightedPerCodeKappa([0.8, 0.2, 0.5], [0.8, 0.2, 0.5])).toBeCloseTo(1.0);
  });

  it('returns negative for opposite vectors', () => {
    // a = [1, 0, 1, 0], b = [0, 1, 0, 1]
    const k = weightedPerCodeKappa([1, 0, 1, 0], [0, 1, 0, 1]);
    expect(k).toBeLessThan(0);
  });

  it('returns NaN when all values are identical', () => {
    expect(weightedPerCodeKappa([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])).toBeNaN();
  });

  it('returns NaN for empty arrays', () => {
    expect(weightedPerCodeKappa([], [])).toBeNaN();
  });

  it('handles partial agreement', () => {
    // Similar but not identical — should be between 0 and 1
    const k = weightedPerCodeKappa([0.9, 0.1, 0.8, 0.2], [0.8, 0.2, 0.7, 0.3]);
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(1);
  });
});

describe('weightedMultiLabelKappa', () => {
  it('returns 1.0 for identical weight maps', () => {
    const ai = [{ A: 0.9, B: 0.1 }, { A: 0.2, B: 0.8 }];
    const hu = [{ A: 0.9, B: 0.1 }, { A: 0.2, B: 0.8 }];
    expect(weightedMultiLabelKappa(ai, hu, ['A', 'B'])).toBeCloseTo(1.0);
  });

  it('returns NaN when all values degenerate', () => {
    const ai = [{ A: 0.5 }, { A: 0.5 }];
    const hu = [{ A: 0.5 }, { A: 0.5 }];
    expect(weightedMultiLabelKappa(ai, hu, ['A'])).toBeNaN();
  });

  it('handles missing codes in maps', () => {
    const ai: Record<string, number>[] = [{ A: 0.9 }, { B: 0.8 }];
    const hu: Record<string, number>[] = [{ A: 0.9 }, { B: 0.8 }];
    const k = weightedMultiLabelKappa(ai, hu, ['A', 'B']);
    expect(k).toBeCloseTo(1.0);
  });
});

describe('weightedPerCodePercentAgreement', () => {
  it('returns 1.0 for identical vectors', () => {
    expect(weightedPerCodePercentAgreement([0.9, 0.1, 0.5], [0.9, 0.1, 0.5])).toBeCloseTo(1.0);
  });

  it('returns 0.0 for maximally different vectors', () => {
    expect(weightedPerCodePercentAgreement([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns intermediate value for partial difference', () => {
    // |0.8-0.6| + |0.2-0.4| = 0.2 + 0.2 = 0.4, mean = 0.2, agreement = 0.8
    expect(weightedPerCodePercentAgreement([0.8, 0.2], [0.6, 0.4])).toBeCloseTo(0.8);
  });

  it('returns 0 for empty arrays', () => {
    expect(weightedPerCodePercentAgreement([], [])).toBe(0);
  });
});
