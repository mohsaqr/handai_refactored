export const dynamic = 'force-dynamic';
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

      const schemaHint = step.output_fields
        .map((f) => `- ${f.name} (${f.type}): ${f.constraints ?? "no constraints"}`)
        .join("\n");

      const systemPrompt = `TASK: ${step.task}\n\nOUTPUT SCHEMA (JSON):\n${schemaHint}\n\nIMPORTANT: Return a valid JSON object. Do not include any other text.`;

      const { text } = await withRetry(
        () =>
          generateText({
            model: aiModel,
            system: systemPrompt,
            prompt: `Input Data: ${JSON.stringify(inputData)}`,
            temperature: 0,
          }),
        { maxAttempts: 3, baseDelayMs: 100 }
      );

      const parsedOutput = extractJson(text);
      if (parsedOutput) {
        cumulativeData = { ...cumulativeData, ...parsedOutput };
        stepResults.push({ step: step.name, output: parsedOutput, success: true });
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
