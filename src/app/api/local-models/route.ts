export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";

async function tryFetch(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(2000), cache: "no-store" });
  } catch {
    return null;
  }
}

export async function GET() {
  const result: Record<string, string[]> = {};

  // Ollama — GET /api/tags returns { models: [{ name, ... }] }
  const ollamaRes = await tryFetch("http://localhost:11434/api/tags");
  if (ollamaRes?.ok) {
    try {
      const data = await ollamaRes.json();
      result.ollama = (data.models ?? []).map((m: { name: string }) => m.name);
    } catch {}
  }

  // LM Studio — GET /v1/models returns OpenAI-compatible { data: [{ id, ... }] }
  const lmRes = await tryFetch("http://localhost:1234/v1/models");
  if (lmRes?.ok) {
    try {
      const data = await lmRes.json();
      result.lmstudio = (data.data ?? []).map((m: { id: string }) => m.id);
    } catch {}
  }

  return NextResponse.json(result);
}
