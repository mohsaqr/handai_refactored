import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { DocumentProcessSchema } from "@/lib/validation";

// ── Text extraction (reuses same logic as document-extract) ──────────────────

const CHAR_LIMIT = 50_000;

interface ExtractResult {
  text: string;
  truncated: boolean;
  charCount: number;
}

async function extractText(fileContent: string, fileType: string): Promise<ExtractResult> {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileContent, "base64");
    if (buffer.length === 0) throw new Error("File content is empty after base64 decode.");
  } catch (err) {
    throw new Error(`Invalid file content: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (["txt", "md", "json", "html", "csv"].includes(fileType)) {
    let text: string;
    const hasUtf8Bom = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
    const src = hasUtf8Bom ? buffer.subarray(3) : buffer;
    const utf8 = src.toString("utf-8");
    if (!hasUtf8Bom && utf8.includes("\uFFFD")) {
      const td = new TextDecoder("windows-1252");
      text = td.decode(src);
    } else {
      text = utf8;
    }
    const charCount = text.length;
    const truncated = charCount > CHAR_LIMIT;
    return { text: truncated ? text.slice(0, CHAR_LIMIT) : text, truncated, charCount };
  }

  if (fileType === "pdf") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjsLib = await import("pdfjs-dist") as any;
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse, PasswordException } = await import("pdf-parse") as any;

    let rawText: string;
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      rawText = result.text as string;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (
        (PasswordException && err instanceof PasswordException) ||
        lower.includes("password") ||
        lower.includes("encrypted")
      ) {
        throw new Error("This PDF is password-protected. Please remove the password before uploading.");
      }
      if (lower.includes("invalid pdf") || lower.includes("unexpected")) {
        throw new Error("This PDF appears to be corrupted or is not a valid PDF file.");
      }
      throw new Error(`PDF could not be read: ${msg}`);
    }

    if (!rawText.trim()) {
      throw new Error("This PDF appears to be image-only. No text layer was found. Please run OCR first.");
    }

    const charCount = rawText.length;
    const truncated = charCount > CHAR_LIMIT;
    return { text: truncated ? rawText.slice(0, CHAR_LIMIT) : rawText, truncated, charCount };
  }

  if (fileType === "excel") {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const lines: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        if (csv.trim()) {
          if (workbook.SheetNames.length > 1) lines.push(`--- Sheet: ${sheetName} ---`);
          lines.push(csv.trim());
        }
      }
      const text = lines.join("\n\n");
      if (!text) throw new Error("This Excel file appears to be empty.");
      const charCount = text.length;
      const truncated = charCount > CHAR_LIMIT;
      return { text: truncated ? text.slice(0, CHAR_LIMIT) : text, truncated, charCount };
    } catch (err) {
      if (err instanceof Error && err.message.includes("empty")) throw err;
      throw new Error(`Excel file could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (fileType === "docx") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      if (!result.value.trim()) {
        throw new Error("This DOCX file appears to be empty or contains only images.");
      }
      const text = result.value;
      const charCount = text.length;
      const truncated = charCount > CHAR_LIMIT;
      return { text: truncated ? text.slice(0, CHAR_LIMIT) : text, truncated, charCount };
    } catch (err) {
      if (err instanceof Error && err.message.includes("empty or contains")) throw err;
      throw new Error(`DOCX could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Unsupported file type: ${fileType}`);
}

// ── POST /api/document-process ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = DocumentProcessSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fileContent, fileType, fileName, provider, model, apiKey, baseUrl, systemPrompt } =
      parsed.data;

    const { text: rawText, truncated, charCount } = await extractText(fileContent, fileType);

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: "Document appears to be empty or unreadable" },
        { status: 422 }
      );
    }

    const aiModel = getModel(provider, model, apiKey, baseUrl);

    const { text } = await withRetry(
      () =>
        generateText({
          model: aiModel,
          system: systemPrompt,
          prompt: `Document: ${fileName ?? "untitled"}\n\n${rawText}`,
          maxOutputTokens: 4096,
        }),
      { maxAttempts: 3, baseDelayMs: 200 }
    );

    return NextResponse.json({
      text,
      fileName: fileName ?? "untitled",
      charCount,
      truncated,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("document-process error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
