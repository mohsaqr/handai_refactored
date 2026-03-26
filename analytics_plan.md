# AI Coder Analytics — Technical Documentation

## Overview

The AI Coder Analytics dashboard provides professional research-grade metrics for evaluating AI-assisted qualitative coding. It compares AI suggestions against human reviewer decisions using **probability-weighted** calculations, ensuring that low-confidence AI suggestions don't inflate agreement scores.

---

## Weighting System

### AI Weights

The AI returns a probability distribution across all codes for each row, summing to 100%. These are normalized to [0,1] for calculations.

| Code | Raw Confidence | Normalized Weight |
|------|---------------|-------------------|
| A    | 80%           | 0.80              |
| B    | 15%           | 0.15              |
| C    | 5%            | 0.05              |

### Human Weights

When a human selects N codes, each receives an equal split weight of `1/N`.

| Codes Selected | Weight per Code |
|---------------|-----------------|
| 1 code        | 1.00            |
| 2 codes       | 0.50 each       |
| 3 codes       | 0.33 each       |
| 4 codes       | 0.25 each       |

### Why Weighted?

**Binary counting (old):** AI suggests A (90%), B (5%), C (5%) → counts as 3 suggestions. This inflates frequency and makes a 5% guess equal to a 90% prediction.

**Weighted counting (current):** The same row contributes 0.90 to A, 0.05 to B, 0.05 to C. Low-confidence suggestions have proportionally low impact on all metrics.

---

## Dashboard Sections

### 1. Summary KPI Cards

Six cards displayed at the top:

| Card | Formula |
|------|---------|
| **Total Rows** | Count of all data rows |
| **AI Processed** | Count of rows where AI produced at least one code |
| **Human Reviewed** | Count of rows where human applied at least one code |
| **AI→Human Accept** | `totalAccepted / totalAISuggested × 100` (weighted) |
| **Weighted Kappa** | Macro-average of per-code weighted kappa (see Section 5) |
| **Overall F1** | Macro-average of per-code F1 scores |

---

### 2. Code Frequency & Agreement Table

Per-code accuracy metrics using weighted counts.

#### Columns

| Column | Formula | Meaning |
|--------|---------|---------|
| **AI Suggested** | `Σ aiConfidence[code] / 100` across all rows | Total weighted AI support for this code |
| **Human Applied** | `Σ 1/N` across rows where human selected this code | Total weighted human support for this code |
| **Accepted** | `Σ min(aiWeight, humanWeight)` per row | Weighted agreement — capped by the weaker signal |
| **Precision** | `Accepted / AI Suggested × 100` | Of all weight AI gave this code, how much did the human validate? |
| **Recall** | `Accepted / Human Applied × 100` | Of all weight the human gave this code, how much did the AI also cover? |
| **F1** | `2 × Precision × Recall / (Precision + Recall)` | Harmonic mean — balances precision and recall |
| **Distribution** | `AI Suggested / Total AI Suggested × 100` | Relative frequency bar |

#### Example

```
Row 1: AI → A=0.90, B=0.05, C=0.05    Human → A, B (each 0.50)
Row 2: AI → A=0.10, B=0.85, C=0.05    Human → B (1.00)
Row 3: AI → A=0.60, B=0.30, C=0.10    Human → A (1.00)

Code A:
  AI Suggested  = 0.90 + 0.10 + 0.60 = 1.50
  Human Applied = 0.50 + 0.00 + 1.00 = 1.50
  Accepted      = min(0.90,0.50) + min(0.10,0) + min(0.60,1.00) = 0.50 + 0 + 0.60 = 1.10
  Precision     = 1.10 / 1.50 × 100 = 73%
  Recall        = 1.10 / 1.50 × 100 = 73%
  F1            = 2 × 73 × 73 / (73 + 73) = 73%
```

#### Why `min()` for Accepted?

The `min` function caps agreement at the weaker signal:
- AI gives 90% confidence but human only gives 50% weight → agreement is 0.50
- AI gives 5% confidence but human gives 100% weight → agreement is only 0.05
- Prevents low-confidence "lucky guesses" from inflating scores

---

### 3. Inter-Rater Agreement Matrix

A cross-tabulation table showing where AI and human agree and disagree, with per-code reliability statistics.

#### Structure

- **Rows** = Human codes
- **Columns** = AI codes
- **Cells** = `Σ humanSplitWeight × aiConfidence` (doubly-weighted)
- **Diagonal cells** (e.g., A×A) = agreement
- **Off-diagonal cells** (e.g., A×B) = confusion — human said A, AI said B

#### Per-Code Statistics (right columns)

| Metric | Formula | Meaning |
|--------|---------|---------|
| **% Agree** | `1 - mean(\|aiWeight - humanWeight\|)` | Continuous agreement, 1.0 = perfect match |
| **Kappa** | Weighted concordance kappa (see Section 5) | Agreement corrected for chance |

#### Cell Coloring

Cells use the code's color with opacity proportional to value:
- High value → dark (strong relationship)
- Low/zero value → transparent

#### Reading the Matrix

- **Strong diagonal** = AI and human agree on most codes
- **Heavy off-diagonal cell at [A][B]** = human frequently codes A where AI codes B (systematic confusion)
- **Empty row** = human rarely applies that code
- **Empty column** = AI rarely suggests that code

---

### 4. Mosaic Plot

A visual representation of the agreement matrix as proportional-area rectangles.

#### How to Read

- **Column width** = AI code frequency (wider = AI suggests it more often)
- **Cell height within column** = human code share for that AI code
- **Diagonal tiles** (same code) = agreement areas, shown with high opacity
- **Off-diagonal tiles** = confusion areas, shown with low opacity
- **Tile area** = proportional to the doubly-weighted count

#### Hover Tooltip

Shows exact values: weighted count, % of AI column, % of human row.

#### Color Encoding

Each tile uses the human code's color from the 8-color palette. Opacity encodes agreement density:
- **Dark** (high opacity) = strong agreement on diagonal
- **Light** (low opacity) = weak off-diagonal confusion

---

### 5. Weighted Kappa (Concordance Correlation)

Standard Cohen's Kappa works with binary (yes/no) data. Since our data uses continuous weights [0,1], we use a concordance-based variant equivalent to Lin's Concordance Correlation Coefficient.

#### Formula

```
κ = 1 - mean((a_i - b_i)²) / (var(a) + var(b) + (μa - μb)²)
```

Where:
- `a_i` = AI weight for the code in row i
- `b_i` = Human weight for the code in row i
- `var(a)` = variance of AI weight vector
- `var(b)` = variance of human weight vector
- `μa`, `μb` = means of each vector

#### Why Not Binary Kappa?

Binary kappa treats a 90% confidence suggestion the same as a 5% suggestion — both count as "1". The weighted variant preserves the nuance of the probability distribution.

#### Interpretation (Landis & Koch, 1977)

| Kappa Range | Label | Practical Meaning |
|-------------|-------|-------------------|
| < 0         | **Poor** | Systematic disagreement — worse than random |
| 0.00 – 0.20 | **Slight** | Barely better than chance |
| 0.21 – 0.40 | **Fair** | Some agreement, but unreliable for research |
| 0.41 – 0.60 | **Moderate** | Decent agreement, review recommended |
| 0.61 – 0.80 | **Substantial** | Strong agreement — publishable in most research |
| 0.81 – 1.00 | **Almost Perfect** | Near-complete agreement |

#### What Kappa Corrects For

% Agreement has a flaw: if a code is rare, both raters give it ~0 weight most of the time, inflating agreement **by chance**. Kappa corrects for this by comparing observed agreement against expected agreement under independence.

**Example:** Code C is rare — both AI and human give it near-zero weight on every row.
- % Agreement says 95% (both agree it doesn't apply)
- Kappa says ~0.00 (agreeing on absence is trivially easy — no meaningful signal)

#### Overall Kappa

The summary card shows the **macro-average**: compute weighted kappa for each code independently, skip degenerate cases (NaN), average the rest.

---

### 6. Disagreements Table

A navigation tool showing rows where AI and human disagree on which codes to apply.

#### How Disagreements Are Detected

For each human-reviewed row:
1. Count how many codes the human selected (N)
2. Take the AI's top-N codes ranked by probability
3. Compare the two sets — if they differ, it's a disagreement

**Example:**
```
AI confidence: A=90%, B=5%, C=5%    Human selected: A, C  (2 codes)
AI's top-2:    {A, B}
Mismatch:      AI has B, Human has C → disagreement
```

This is smarter than comparing all AI suggestions — it only flags cases where the AI's best predictions don't match the human's choices.

#### Display

Each disagreement row shows:
- **Row number** + text preview (left)
- **Human:** all codes the human selected (green badges, right)
- **AI:** all codes with probability > 0, sorted by confidence, each showing its percentage (orange dashed badges, right)
- **Go to row →** button for direct navigation to the review panel

---

## Export

The **Export Analytics** button generates a self-contained HTML report (`analytics-report.html`) containing:

1. Summary KPI cards
2. Code Frequency & Agreement table
3. Inter-Rater Agreement Matrix with cell coloring
4. Mosaic Plot (embedded SVG)
5. Disagreements table

The HTML file opens in any browser and can be printed to PDF for publication or sharing.

---

## File Locations

| File | Purpose |
|------|---------|
| `src/lib/analytics.ts` | Statistical functions: f1Score, weightedPerCodeKappa, weightedMultiLabelKappa, weightedPerCodePercentAgreement, weightedAgreementMatrix |
| `src/app/ai-coder/AnalyticsDialog.tsx` | Analytics UI: KPI cards, per-code table, agreement matrix, mosaic plot, disagreements, HTML export |
| `src/app/ai-coder/page.tsx` | Passes `aiData` prop to AnalyticsPanel |
| `src/types/index.ts` | WeightedMatrix interface |
| `src/lib/__tests__/analytics.test.ts` | 58 tests covering all statistical functions |
