export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { DocumentExtractSchema } from "@/lib/validation";

const DEFAULT_SYSTEM_PROMPT = `You are a document extraction expert. Extract all meaningful information from the provided document text.
Structure the output as a JSON array of objects, where each object represents one logical record or entry.
Each record should have consistent field names across all records.
Return ONLY a valid JSON array. No explanations. No markdown code blocks.
Example: [{"field1": "value1", "field2": "value2"}, ...]`;

async function extractText(fileContent: string, fileType: string): Promise<string> {
  const buffer = Buffer.from(fileContent, "base64");

  if (fileType === "txt" || fileType === "md") {
    return buffer.toString("utf-8");
  }

  if (fileType === "pdf") {
    try {
      // pdf-parse is a CommonJS module — use namespace import
      const pdfParseModule = await import("pdf-parse");
      const pdfParse = (pdfParseModule as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default ?? pdfParseModule;
      const result = await (pdfParse as (buf: Buffer) => Promise<{ text: string }>)(buffer);
      return result.text;
    } catch (err) {
      throw new Error(`PDF parsing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (fileType === "docx") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (err) {
      throw new Error(`DOCX parsing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Unsupported file type: ${fileType}`);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = DocumentExtractSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fileContent, fileType, fileName, provider, model, apiKey, baseUrl, systemPrompt } =
      parsed.data;

    // Extract raw text from file
    const rawText = await extractText(fileContent, fileType);

    if (!rawText.trim()) {
      return NextResponse.json({ error: "Document appears to be empty or unreadable" }, { status: 422 });
    }

    const aiModel = getModel(provider, model, apiKey, baseUrl);

    const { text } = await withRetry(
      () =>
        generateText({
          model: aiModel,
          system: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          prompt: `Document: ${fileName ?? "untitled"}\n\n${rawText.slice(0, 50000)}`,
          temperature: 0,
          maxOutputTokens: 4096,
        }),
      { maxAttempts: 3, baseDelayMs: 200 }
    );

    // Parse JSON response
    let records: Record<string, unknown>[] = [];
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
      const parsed = JSON.parse(cleaned);
      records = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Return raw text if JSON parse fails
      records = [{ extracted_text: text }];
    }

    return NextResponse.json({
      records,
      fileName: fileName ?? "untitled",
      charCount: rawText.length,
      count: records.length,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("document-extract error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
