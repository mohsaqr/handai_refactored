import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { AutomatorRowSchema } from "@/lib/validation";

function extractJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {}
    }
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch {}
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AutomatorRowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { row, steps, provider, model, apiKey, baseUrl } = parsed.data;
    const aiModel = getModel(provider, model, apiKey, baseUrl);

    let cumulativeData: Record<string, unknown> = { ...row };
    const stepResults: Array<{ step: string; output?: unknown; raw?: string; success: boolean; error?: string }> = [];

    for (const step of steps) {
      const inputData: Record<string, unknown> = {};
      if (step.input_fields.length > 0) {
        step.input_fields.forEach((f) => {
          inputData[f] = cumulativeData[f];
        });
      } else {
        Object.assign(inputData, cumulativeData);
      }

      const expectedFields = step.output_fields.map((f) => f.name);
      const schemaHint = step.output_fields
        .map((f) => `"${f.name}": <${f.type}>${f.constraints ? ` (${f.constraints})` : ""}`)
        .join(",\n  ");

      const systemPrompt = `TASK: ${step.task}

Return a JSON object with EXACTLY these keys — no other keys, no renaming, no translation:
{
  ${schemaHint}
}

RULES:
- Use the EXACT field names shown above (in English, as-is) — never translate or rename keys
- The keys in the input data are field identifiers, NOT content — do not translate or transform them
- Apply the task ONLY to the values, not the keys
- Each value must be a plain ${step.output_fields.length === 1 ? step.output_fields[0].type : "string or number"} — never a nested object
- Do not wrap values in objects like {"text": "..."} — return the value directly
- No markdown, no code fences, no explanation — return ONLY the JSON object`;

      const { text } = await withRetry(
        () =>
          generateText({
            model: aiModel,
            system: systemPrompt,
            prompt: `Input Data (keys are field identifiers — do NOT translate them):\n${JSON.stringify(inputData)}`,
          }),
        { maxAttempts: 3, baseDelayMs: 100 }
      );

      const parsedOutput = extractJson(text);
      if (parsedOutput) {
        // Normalize: keep only expected fields, unwrap nested single-key objects, coerce types
        const normalized: Record<string, unknown> = {};
        for (const fieldName of expectedFields) {
          let val = parsedOutput[fieldName];
          // If exact key not found, try case-insensitive or partial match
          if (val === undefined) {
            const lowerField = fieldName.toLowerCase();
            const matchKey = Object.keys(parsedOutput).find(
              (k) => k.toLowerCase() === lowerField || k.toLowerCase().replace(/[_\s]/g, "") === lowerField.replace(/[_\s]/g, "")
            );
            if (matchKey) val = parsedOutput[matchKey];
          }
          // Unwrap nested single-key objects like {"text": "actual value"}
          if (val !== null && val !== undefined && typeof val === "object" && !Array.isArray(val)) {
            const entries = Object.entries(val as Record<string, unknown>);
            val = entries.length === 1 ? entries[0][1] : JSON.stringify(val);
          }
          if (Array.isArray(val)) {
            val = val.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ");
          }
          if (val !== undefined) normalized[fieldName] = val;
        }
        cumulativeData = { ...cumulativeData, ...normalized };
        stepResults.push({ step: step.name, output: normalized, success: true });
      } else {
        stepResults.push({ step: step.name, raw: text, success: false, error: "Failed to parse JSON" });
      }
    }

    return NextResponse.json({ output: cumulativeData, stepResults, success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("automator-row error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
