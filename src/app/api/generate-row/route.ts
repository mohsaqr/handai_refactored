export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { GenerateRowSchema } from "@/lib/validation";
import { getPrompt } from "@/lib/prompts";

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  return lines.slice(1).map((line) => {
    // Simple CSV parse: handle quoted fields
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        values.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    values.push(current);

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx]?.trim() ?? "";
    });
    return row;
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = GenerateRowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { provider, model, apiKey, baseUrl, rowCount, columns, freeformPrompt, temperature } =
      parsed.data;

    const aiModel = getModel(provider, model, apiKey, baseUrl);

    let systemPrompt: string;
    let userPrompt: string;

    if (columns && columns.length > 0) {
      systemPrompt = getPrompt("generate.csv_with_cols");
      const colDefs = columns
        .map((c) => `${c.name} (${c.type}${c.description ? `: ${c.description}` : ""})`)
        .join(", ");
      const headerLine = columns.map((c) => c.name).join(",");
      userPrompt = `Generate ${rowCount} rows of realistic data.\nColumns: ${colDefs}\nCSV Header must be: ${headerLine}`;
    } else {
      systemPrompt = getPrompt("generate.csv_freeform");
      userPrompt = `${freeformPrompt ?? "Generate a realistic dataset"}\nGenerate exactly ${rowCount} rows.`;
    }

    const { text } = await withRetry(
      () =>
        generateText({
          model: aiModel,
          system: systemPrompt,
          prompt: userPrompt,
          temperature: temperature ?? 0.7,
          maxOutputTokens: Math.min(rowCount * 200 + 500, 8000),
        }),
      { maxAttempts: 3, baseDelayMs: 200 }
    );

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:csv)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
    const rows = parseCsv(cleaned);

    return NextResponse.json({ rows, rawCsv: cleaned, count: rows.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("generate-row error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
