/**
 * Central prompt registry — port of Python's prompt_registry.py
 * Prompts can be overridden per-browser via localStorage.
 */

export interface PromptDef {
  id: string;
  name: string;
  category: string;
  defaultValue: string;
}

export const PROMPTS: Record<string, PromptDef> = {
  // ── Transform ──────────────────────────────────────────────────────
  "transform.default": {
    id: "transform.default",
    name: "Transform — Default",
    category: "transform",
    defaultValue: `You are a precise data transformation assistant.
Apply the requested transformation to the input data and return ONLY the result.
- No explanations, no preamble, no markdown
- Return only the transformed value(s) in CSV format if multiple columns are requested
- Preserve original formatting unless explicitly asked to change it`,
  },

  // ── Qualitative Coding ─────────────────────────────────────────────
  "qualitative.default": {
    id: "qualitative.default",
    name: "Qualitative — Default",
    category: "qualitative",
    defaultValue: `You are a qualitative research assistant. Analyze the provided data and apply the appropriate codes.
Return ONLY the codes as a comma-separated list.
No explanations. No prose. Just the codes.`,
  },

  "qualitative.rigorous": {
    id: "qualitative.rigorous",
    name: "Qualitative — Rigorous",
    category: "qualitative",
    defaultValue: `You are an expert qualitative researcher using grounded theory methodology.
Carefully read the text and apply codes that capture the manifest AND latent meaning.
Consider: participant perspective, emotional tone, implied meaning, and context.
Return ONLY the applicable codes as a comma-separated list. No explanations.`,
  },

  // ── Consensus Coder ────────────────────────────────────────────────
  "consensus.worker_default": {
    id: "consensus.worker_default",
    name: "Consensus — Worker (Default)",
    category: "consensus",
    defaultValue: `Analyze the provided data and respond with ONLY the requested output values.

CRITICAL FORMAT REQUIREMENTS:
- Output MUST be in strict CSV format (comma-separated values)
- NO explanations, NO prose, NO markdown, NO code blocks
- NO headers or labels - just the raw values

Respond with ONLY the CSV-formatted data values. Nothing else.`,
  },

  "consensus.worker_rigorous": {
    id: "consensus.worker_rigorous",
    name: "Consensus — Worker (Rigorous)",
    category: "consensus",
    defaultValue: `You are an expert qualitative analyst. Apply rigorous coding to the data.
Return results in strict CSV format only. No explanations. No headers.
Consider latent meaning, context, and theoretical saturation before responding.`,
  },

  "consensus.judge_default": {
    id: "consensus.judge_default",
    name: "Consensus — Judge (Default)",
    category: "consensus",
    defaultValue: `You are a judge synthesizing worker responses into a single best answer.

CRITICAL: Your best_answer MUST be in strict CSV/tabular format:
- Comma-separated values ONLY
- NO explanations, NO prose, NO markdown
- NO headers - just the data values

If workers disagree, choose the most accurate/complete values and format as CSV.`,
  },

  "consensus.judge_enhanced": {
    id: "consensus.judge_enhanced",
    name: "Consensus — Judge (Enhanced)",
    category: "consensus",
    defaultValue: `You are a senior qualitative researcher arbitrating between worker coders.
Review all worker responses carefully. Identify areas of agreement and disagreement.
When workers disagree, use your expertise to determine the correct interpretation.
Return ONLY the final best answer in CSV format. No explanations. No metadata.`,
  },

  // ── Codebook Generator ─────────────────────────────────────────────
  "codebook.discovery": {
    id: "codebook.discovery",
    name: "Codebook — Discovery",
    category: "codebook",
    defaultValue: `You are a qualitative researcher performing open coding.
Analyze the provided text samples and identify recurring themes, patterns, and concepts.
Return a JSON array of raw theme objects:
[{"theme": "Theme Name", "description": "brief description", "examples": ["quote1", "quote2"]}]
Return ONLY the JSON array. No other text.`,
  },

  "codebook.consolidation": {
    id: "codebook.consolidation",
    name: "Codebook — Consolidation",
    category: "codebook",
    defaultValue: `You are a qualitative researcher performing axial coding.
Review the provided list of raw themes and:
1. Merge overlapping or redundant themes
2. Group related themes into higher-level categories
3. Remove themes that appear in fewer than 2 examples
Return a JSON array of consolidated themes:
[{"theme": "Theme Name", "category": "Category", "merged_from": ["old1", "old2"], "description": "..."}]
Return ONLY the JSON array. No other text.`,
  },

  "codebook.definition": {
    id: "codebook.definition",
    name: "Codebook — Definition",
    category: "codebook",
    defaultValue: `You are a qualitative researcher creating a formal codebook.
For each provided theme, write a formal code definition following best practices:
- Clear, unambiguous definition (2-3 sentences)
- Inclusion criteria (when to apply this code)
- Exclusion criteria (when NOT to apply)
- 2-3 anchor examples from the data
Return a JSON array:
[{"code": "CODE_NAME", "definition": "...", "inclusion": "...", "exclusion": "...", "examples": ["..."]}]
Return ONLY the JSON array. No other text.`,
  },

  // ── Generate Data ──────────────────────────────────────────────────
  "generate.column_suggestions": {
    id: "generate.column_suggestions",
    name: "Generate — Column Suggestions",
    category: "generate",
    defaultValue: `You are a data generation expert. Suggest appropriate column names and types for the described dataset.
Return a JSON array: [{"name": "column_name", "type": "text|number|boolean|list", "description": "..."}]
Return ONLY the JSON array. No other text.`,
  },

  "generate.csv_with_cols": {
    id: "generate.csv_with_cols",
    name: "Generate — CSV with Schema",
    category: "generate",
    defaultValue: `Generate realistic synthetic data rows in CSV format.
Requirements:
- Generate EXACTLY the number of rows requested
- Use ONLY the specified columns in the specified order
- First line MUST be the CSV header
- Use realistic, diverse values — no placeholders like "value1"
- Numeric columns: use appropriate ranges
- Text columns: use varied, realistic content
Return ONLY the CSV content. No explanations. No code blocks.`,
  },

  "generate.csv_freeform": {
    id: "generate.csv_freeform",
    name: "Generate — CSV Freeform",
    category: "generate",
    defaultValue: `Generate realistic synthetic data in CSV format based on the description.
Requirements:
- Generate EXACTLY the number of rows requested
- Design appropriate columns for the described dataset
- First line MUST be the CSV header
- Use realistic, diverse, varied values
Return ONLY the CSV content. No explanations. No code blocks.`,
  },

  // ── Automator ─────────────────────────────────────────────────────
  "automator.rules": {
    id: "automator.rules",
    name: "Automator — Step Rules",
    category: "automator",
    defaultValue: `TASK: {task}

OUTPUT SCHEMA (JSON):
{schema}

IMPORTANT:
- Return a valid JSON object matching the schema exactly
- Do not include any text outside the JSON
- Use null for missing or unknown values`,
  },

  // ── Abstract Screener ──────────────────────────────────────────────
  "screener.default": {
    id: "screener.default",
    name: "Screener — Default",
    category: "screener",
    defaultValue: `You are a systematic review screener. Apply the criteria below to decide if this abstract should be included or excluded.

CRITERIA:
{criteria}

Return ONLY valid JSON (no markdown, no prose):
{"decision":"include","confidence":0.92,"reasoning":"one sentence","highlight_terms":["term1","term2"]}

- decision: "include" or "exclude"
- confidence: 0.0–1.0 how certain you are
- reasoning: one sentence explaining the key reason
- highlight_terms: 3–8 words or short phrases from the abstract that most influenced your decision`,
  },

  // ── AI Coder ───────────────────────────────────────────────────────
  "ai_coder.suggestions": {
    id: "ai_coder.suggestions",
    name: "AI Coder — Suggestions",
    category: "ai_coder",
    defaultValue: `Analyze the text and suggest applicable codes from the provided list.
Return ONLY a JSON array of the suggested code names.
Example: ["Positive Experience", "Quality Concern"]
Only suggest codes that clearly apply. Do not invent new codes.`,
  },
};

const OVERRIDE_PREFIX = "handai_prompt_override:";

/**
 * Returns the prompt value — localStorage override first, then default.
 * Safe to call server-side (no localStorage access on server).
 */
export function getPrompt(id: string): string {
  const def = PROMPTS[id];
  if (!def) {
    console.warn(`Unknown prompt id: ${id}`);
    return "";
  }

  if (typeof window !== "undefined") {
    const override = localStorage.getItem(`${OVERRIDE_PREFIX}${id}`);
    if (override !== null) return override;
  }

  return def.defaultValue;
}

export function setPromptOverride(id: string, value: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(`${OVERRIDE_PREFIX}${id}`, value);
  }
}

export function clearPromptOverride(id: string): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(`${OVERRIDE_PREFIX}${id}`);
  }
}

export function getPromptsByCategory(category: string): PromptDef[] {
  return Object.values(PROMPTS).filter((p) => p.category === category);
}
