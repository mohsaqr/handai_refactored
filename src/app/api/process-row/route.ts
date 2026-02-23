export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { ProcessRowSchema } from "@/lib/validation";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ProcessRowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      provider,
      model,
      apiKey,
      baseUrl,
      systemPrompt,
      userContent,
      rowIdx,
      runId,
      temperature,
      maxTokens,
    } = parsed.data;

    const aiModel = getModel(provider, model, apiKey, baseUrl);

    const startTime = Date.now();
    const { text: outputText } = await withRetry(
      () =>
        generateText({
          model: aiModel,
          system: systemPrompt,
          prompt: userContent,
          temperature: temperature ?? 0,
          maxOutputTokens: maxTokens ?? undefined,
        }),
      { maxAttempts: 3, baseDelayMs: 100 }
    );
    const duration = (Date.now() - startTime) / 1000;

    // Log to DB separately — a logging failure must never mask a successful LLM result
    if (runId) {
      try {
        await prisma.runResult.create({
          data: {
            runId,
            rowIndex: rowIdx ?? 0,
            inputJson: JSON.stringify({ content: userContent }),
            output: outputText,
            status: "SUCCESS",
            latency: duration,
          },
        });
      } catch (dbErr) {
        console.error("process-row: DB log failed (result still returned):", dbErr);
      }
    }

    return NextResponse.json({ output: outputText, latency: duration });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("process-row error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
