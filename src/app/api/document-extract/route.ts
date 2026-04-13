import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { DocumentExtractSchema } from "@/lib/validation";
import { getPrompt, formatExtractionSchemaJson } from "@/lib/prompts";

// ── Default prompt when no field schema is provided ───────────────────────────

const DEFAULT_SYSTEM_PROMPT = `You are a document data extraction engine. Extract all structured records from the document as a CSV table.

OUTPUT RULES:
1. Output ONLY raw CSV. Nothing else.
2. Row 1: CSV header (design appropriate column names based on the document content).
3. Rows 2+: one extracted record per row, values matching the header columns.
4. Wrap fields containing commas or line breaks in double quotes.

STRICTLY FORBIDDEN: markdown, code blocks, JSON, explanations, or prose.`;

// ── Text extraction (server-side via pdf-parse + mammoth) ─────────────────────

interface ExtractResult {
  text: string;
  truncated: boolean;
  charCount: number;
}

const CHAR_LIMIT = 50_000;

async function extractText(fileContent: string, fileType: string): Promise<ExtractResult> {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileContent, "base64");
    if (buffer.length === 0) throw new Error("File content is empty after base64 decode.");
  } catch (err) {
    throw new Error(`Invalid file content: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (["txt", "md", "json", "html", "csv"].includes(fileType)) {
    // Detect encoding: strip UTF-8 BOM, try UTF-8, fallback to Windows-1252
    let text: string;
    const hasUtf8Bom = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
    const src = hasUtf8Bom ? buffer.subarray(3) : buffer;
    const utf8 = src.toString("utf-8");
    // If UTF-8 decoding produces replacement chars, try Windows-1252
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
    // pdf-parse v2 uses a class-based API.
    // Disable pdfjs worker — it fails when Turbopack bundles into server chunks.
    // serverExternalPackages in next.config.ts keeps these in node_modules at runtime.
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
      throw new Error(
        "This PDF appears to be image-only. No text layer was found. Please run OCR first."
      );
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

// ── CSV parser — handles quoted fields, strips accidental markdown fences ─────

function parseCsvResponse(raw: string): Record<string, unknown>[] {
  const text = raw.replace(/^```[^\n]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        values.push(current); current = "";
      } else {
        current += ch;
      }
    }
    values.push(current);
    return values.map((v) => v.trim());
  };

  const headers = parseRow(lines[0]);
  if (headers.length === 0) return [];

  return lines.slice(1).map((line) => {
    const values = parseRow(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

// ── JSON parser — tries direct parse, then embedded JSON extraction ──────────

function tryParseJson(cleaned: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Try to find a JSON array or object embedded in the response
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    const objMatch = !jsonMatch ? cleaned.match(/\{[\s\S]*\}/) : null;
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch { /* fall through */ }
    } else if (objMatch) {
      try {
        return [JSON.parse(objMatch[0])];
      } catch { /* fall through */ }
    }
    return [];
  }
}

// ── POST /api/document-extract ────────────────────────────────────────────────

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

    const { fileContent, fileType, fileName, provider, model, apiKey, baseUrl, systemPrompt, fields } =
      parsed.data;

    const { text: rawText, truncated, charCount } = await extractText(fileContent, fileType);

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: "Document appears to be empty or unreadable" },
        { status: 422 }
      );
    }

    // Fields schema takes priority over custom systemPrompt
    let effectivePrompt: string;
    if (fields && fields.length > 0) {
      const schema = formatExtractionSchemaJson(fields);
      const fieldList = fields
        .map((f) => `- "${f.name}" (${f.type})${f.description ? ": " + f.description : ""}`)
        .join("\n");
      effectivePrompt = `You are a data extraction engine. Your ONLY job is to output a JSON array of records.

The document may be a table, a narrative report, a summary, a prose description, or any other format. Extract whatever data matches the requested fields from ANYWHERE in the text — tables, paragraphs, sentences, bullet points, captions, headings, etc. If the document describes a single subject in prose, return one record. If it describes many subjects, return one record per subject.

FIELDS TO EXTRACT (use these exact JSON keys):
${fieldList}

Each object must follow this shape:
${schema}

ABSOLUTE RULES:
1. Your entire response MUST be a single JSON array. The first character must be "[" and the last character must be "]".
2. No prose. No markdown. No code fences. No headings. No explanations before or after the array.
3. Do NOT write a summary of the document — extract the actual field values.
4. If a field value is not present in the document, use null (not an empty string, not "N/A").
5. If the document contains NO relevant data at all, return exactly: []
6. Always wrap records in an array, even when there is only one: [{ ... }]`;
    } else {
      effectivePrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    }

    const aiModel = getModel(provider, model, apiKey, baseUrl);

    const { text } = await withRetry(
      () =>
        generateText({
          model: aiModel,
          system: effectivePrompt,
          prompt: `Document: ${fileName ?? "untitled"}\n\n${rawText}`,
          maxOutputTokens: 4096,
        }),
      { maxAttempts: 3, baseDelayMs: 200 }
    );

    // Reformat-retry: ask the model to convert its own prose response to JSON.
    const reformatToJson = async (proseText: string): Promise<string> => {
      if (!fields || fields.length === 0) return proseText;
      const fieldList = fields
        .map((f) => `- "${f.name}" (${f.type})${f.description ? ": " + f.description : ""}`)
        .join("\n");
      const reformatPrompt = `You are a JSON reformatter. You will receive text (possibly prose, markdown, or a summary) that describes data. Extract the requested fields from it and return ONLY a JSON array of records.

REQUIRED FIELDS:
${fieldList}

RULES:
1. Output MUST start with "[" and end with "]". Nothing else.
2. No prose, no markdown, no explanations.
3. Use null for missing values.
4. If the text describes one subject, return [{ ... }]. If multiple, return one object per subject.`;
      const { text: reformatted } = await withRetry(
        () =>
          generateText({
            model: aiModel,
            system: reformatPrompt,
            prompt: proseText,
            maxOutputTokens: 4096,
          }),
        { maxAttempts: 2, baseDelayMs: 200 }
      );
      return reformatted;
    };

    // When fields are defined the prompt asks for JSON, so try JSON first.
    // When no fields are defined the prompt asks for CSV, so try CSV first.
    let records: Record<string, unknown>[] = [];
    let cleaned = text.replace(/^```(?:json|csv)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();

    if (fields && fields.length > 0) {
      // JSON-first path (fields defined → prompt asked for JSON)
      records = tryParseJson(cleaned);
      if (records.length === 0) records = parseCsvResponse(text);
      if (records.length === 0) {
        const reformatted = await reformatToJson(text);
        cleaned = reformatted.replace(/^```(?:json|csv)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
        records = tryParseJson(cleaned);
      }
      if (records.length === 0) {
        const preview = text.slice(0, 200).replace(/\s+/g, " ").trim();
        return NextResponse.json({ error: `Model returned unparseable output even after a reformat retry. Try a stronger model. Preview: "${preview}${text.length > 200 ? "…" : ""}"` }, { status: 422 });
      }
    } else {
      // CSV-first path (no fields → prompt asked for CSV)
      records = parseCsvResponse(text);
      if (records.length === 0) records = tryParseJson(cleaned);
      if (records.length === 0) {
        const strippedLines = cleaned.split(/\r?\n/).filter((l) =>
          l.trim() && !l.startsWith("Here") && !l.startsWith("The ") && !l.startsWith("Below")
        );
        const retryRecords = parseCsvResponse(strippedLines.join("\n"));
        records = retryRecords.length > 0 ? retryRecords : [{ extracted_text: text }];
      }
    }

    // Merge single-key objects into one record (LLM sometimes returns one field per object)
    if (records.length > 1 && records.every((r) => Object.keys(r).length === 1)) {
      const merged: Record<string, unknown> = {};
      for (const r of records) Object.assign(merged, r);
      records = [merged];
    }

    // Map LLM-returned keys to defined field names and fill missing with ""
    if (fields && fields.length > 0) {
      const fieldNames = fields.map((f) => f.name);
      const fieldNamesLower = fieldNames.map((n) => n.toLowerCase().replace(/[\s_-]+/g, ""));

      records = records.map((r) => {
        const normalized: Record<string, unknown> = {};
        // First pass: exact matches
        for (const f of fieldNames) {
          if (f in r) normalized[f] = r[f];
        }
        // Second pass: fuzzy match remaining LLM keys to defined fields
        for (const [key, value] of Object.entries(r)) {
          if (fieldNames.includes(key)) continue; // already matched
          const keyNorm = key.toLowerCase().replace(/[\s_-]+/g, "");
          for (let i = 0; i < fieldNamesLower.length; i++) {
            if (normalized[fieldNames[i]] !== undefined) continue; // already filled
            if (keyNorm === fieldNamesLower[i] || keyNorm.endsWith(fieldNamesLower[i]) || keyNorm.includes(fieldNamesLower[i])) {
              normalized[fieldNames[i]] = value;
              break;
            }
          }
        }
        // Fill any still-missing fields with ""
        for (const f of fieldNames) {
          if (normalized[f] === undefined) normalized[f] = "";
        }
        return normalized;
      });

      // If every normalized field on every record is empty/null, surface as error
      const allEmpty = records.every((r) =>
        fieldNames.every((f) => r[f] === "" || r[f] === null || r[f] === undefined)
      );
      if (allEmpty) {
        const preview = text.slice(0, 200).replace(/\s+/g, " ").trim();
        return NextResponse.json({ error: `Model returned no usable field values. The document may lack extractable text (scanned PDF?) or the field definitions don't match its content. Preview: "${preview}${text.length > 200 ? "…" : ""}"` }, { status: 422 });
      }
    }

    return NextResponse.json({ records, fileName: fileName ?? "untitled", charCount, truncated, count: records.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("document-extract error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
