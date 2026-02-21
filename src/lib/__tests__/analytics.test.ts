import { describe, it, expect } from 'vitest';
import {
  cohenKappa,
  pairwiseAgreement,
  exactMatchRate,
  interpretKappa,
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
