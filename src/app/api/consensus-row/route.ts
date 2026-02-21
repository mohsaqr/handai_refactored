import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { ConsensusRowSchema } from "@/lib/validation";
import { cohenKappa, pairwiseAgreement } from "@/lib/analytics";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ConsensusRowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { workers, judge, workerPrompt, judgePrompt, userContent, rowIdx, runId } =
      parsed.data;

    // Step 1: Run workers in parallel
    const workerPromises = workers.map(async (w, i) => {
      const model = getModel(w.provider, w.model, w.apiKey || "local", w.baseUrl);
      const start = Date.now();
      const { text } = await withRetry(
        () =>
          generateText({
            model,
            system: workerPrompt,
            prompt: userContent,
            temperature: 0,
          }),
        { maxAttempts: 3, baseDelayMs: 100 }
      );
      return {
        id: `worker_${i + 1}`,
        output: text,
        latency: (Date.now() - start) / 1000,
      };
    });

    const workerResults = await Promise.all(workerPromises);

    // Step 2: Inter-rater analytics on single-token outputs
    const outputs = workerResults.map((r) => r.output.trim());
    const allSame = outputs.every((o) => o === outputs[0]);
    const consensusType = allSame ? "Full Agreement" : "Disagreement (Synthesized)";

    // Cohen's Kappa on first two workers (character-level for multi-label)
    const w1Tokens = outputs[0].split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    const w2Tokens = outputs[1].split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    const maxLen = Math.max(w1Tokens.length, w2Tokens.length);
    const a = w1Tokens.concat(new Array(Math.max(0, maxLen - w1Tokens.length)).fill(""));
    const b = w2Tokens.concat(new Array(Math.max(0, maxLen - w2Tokens.length)).fill(""));
    const kappa = cohenKappa(a, b);

    // Full pairwise matrix when > 2 workers
    const allTokenized = outputs.map((o) =>
      o
        .split(/[,\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    const maxAllLen = Math.max(...allTokenized.map((t) => t.length), 1);
    const padded = allTokenized.map((t) =>
      t.concat(new Array(Math.max(0, maxAllLen - t.length)).fill(""))
    );
    const agreementMatrix = pairwiseAgreement(padded);

    // Step 3: Run judge
    const judgeModel = getModel(
      judge.provider,
      judge.model,
      judge.apiKey || "local",
      judge.baseUrl
    );
    const workersFormatted = workerResults
      .map((r) => `${r.id} response:\n${r.output}`)
      .join("\n\n---\n\n");
    const combinedContent = `Original Data: ${userContent}\n\nWorker Responses:\n${workersFormatted}`;

    const judgeStart = Date.now();
    const { text: judgeOutput } = await withRetry(
      () =>
        generateText({
          model: judgeModel,
          system: judgePrompt,
          prompt: combinedContent,
          temperature: 0,
        }),
      { maxAttempts: 3, baseDelayMs: 100 }
    );
    const judgeLatency = (Date.now() - judgeStart) / 1000;

    const totalLatency = judgeLatency + Math.max(...workerResults.map((r) => r.latency));

    if (runId) {
      await prisma.runResult.create({
        data: {
          runId,
          rowIndex: rowIdx ?? 0,
          inputJson: JSON.stringify({ content: userContent }),
          output: JSON.stringify({ workers: workerResults, judge: judgeOutput, consensus: consensusType, kappa }),
          status: "SUCCESS",
          latency: totalLatency,
        },
      });
    }

    return NextResponse.json({
      workerResults,
      judgeOutput,
      judgeLatency,
      consensusType,
      kappa: isNaN(kappa) ? null : kappa,
      kappaLabel: isNaN(kappa) ? "N/A" : kappa < 0.2 ? "Poor" : kappa < 0.4 ? "Fair" : kappa < 0.6 ? "Moderate" : kappa < 0.8 ? "Substantial" : "Almost Perfect",
      agreementMatrix,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("consensus-row error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
