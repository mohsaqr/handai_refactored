export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { ComparisonRowSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ComparisonRowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { models, systemPrompt, userContent, temperature } = parsed.data;

    const promises = models.map(async (m) => {
      try {
        const aiModel = getModel(m.provider, m.model, m.apiKey, m.baseUrl);
        const start = Date.now();
        const { text } = await withRetry(
          () =>
            generateText({
              model: aiModel,
              system: systemPrompt,
              prompt: userContent,
              temperature: temperature ?? 0,
            }),
          { maxAttempts: 3, baseDelayMs: 100 }
        );
        return { id: m.id, output: text, latency: (Date.now() - start) / 1000, success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { id: m.id, output: `ERROR: ${msg}`, success: false };
      }
    });

    const results = await Promise.all(promises);
    return NextResponse.json({ results });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("comparison-row error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
