import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { ConsensusRowSchema } from "@/lib/validation";
import { pairwiseJaccard, pairwiseAgreement } from "@/lib/analytics";
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

    const {
      workers,
      judge,
      workerPrompt,
      judgePrompt,
      userContent,
      rowIdx,
      runId,
      enableQualityScoring,
      enableDisagreementAnalysis,
      includeReasoning,
      temperature,
      maxTokens,
    } = parsed.data;
    const llmOpts = {
      ...(temperature !== undefined && { temperature }),
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
    };

    // Enforce direct-answer-only rules on every worker prompt
    const strictSuffix = `\n\nSTRICT OUTPUT RULES (always apply):
- Output ONLY the answer to the instruction. No notes, no explanations, no reasoning, no commentary, no caveats.
- Plain text or CSV only. NEVER use markdown: no **, no ## headings, no bullet points, no code blocks, no backticks.
- Do NOT add headers, labels, introductions, or sign-offs.
- Do NOT prefix with "Answer:", "Result:", "Note:", or any label.
- Do NOT add extra sentences, context, or qualifications.
- If the instruction asks for a single value, return that value and NOTHING else.`;
    const enforced = workerPrompt + strictSuffix;

    // Step 1: Run workers in parallel
    const workerPromises = workers.map(async (w, i) => {
      const model = getModel(w.provider, w.model, w.apiKey || "local", w.baseUrl);
      const start = Date.now();
      const { text } = await withRetry(
        () =>
          generateText({
            model,
            system: enforced,
            prompt: userContent,
            ...llmOpts,
          }),
        { maxAttempts: 3, baseDelayMs: 100 }
      );
      return {
        id: `worker_${i + 1}`,
        output: text,
        latency: (Date.now() - start) / 1000,
      };
    });

    const workerSettled = await Promise.allSettled(workerPromises);
    const workerResults = workerSettled
      .filter((r): r is PromiseFulfilledResult<{ id: string; output: string; latency: number }> => r.status === "fulfilled")
      .map((r) => r.value);

    if (workerResults.length < 2) {
      const errors = workerSettled
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
      return NextResponse.json(
        { error: `Not enough workers succeeded (${workerResults.length}/${workers.length}). Errors: ${errors.join("; ")}` },
        { status: 502 }
      );
    }

    // Step 2: Inter-rater analytics (all workers, set-based)
    const outputs = workerResults.map((r) => r.output.trim());
    const allSame = outputs.every((o) => o === outputs[0]);
    const kappa = pairwiseJaccard(outputs);

    // Pairwise matrix for detailed view
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

    // Step 3: Run judge — also classify consensus level
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

    let judgeOutput: string;
    let judgeLatency: number;
    let consensusType: string;
    let judgeReasoning: string | undefined;

    const judgeDirectSuffix = `\n\nSTRICT OUTPUT RULES (always apply):
- Output ONLY the final answer. No explanations, no reasoning, no commentary, no justifications.
- Plain text only. No markdown, no headings, no bullet points, no code fences.
- Do NOT explain why you chose this answer — just give the answer directly.`;

    if (allSame) {
      consensusType = "Unanimous";
      const judgeStart = Date.now();
      const { text } = await withRetry(
        () =>
          generateText({
            model: judgeModel,
            system: judgePrompt + judgeDirectSuffix,
            prompt: combinedContent,
            ...llmOpts,
          }),
        { maxAttempts: 3, baseDelayMs: 100 }
      );
      judgeOutput = text;
      judgeLatency = (Date.now() - judgeStart) / 1000;
    } else {
      const consensusSuffix = judgeDirectSuffix + `\n\nADDITIONAL TASK — After producing your direct answer, you MUST end your response with a consensus classification on its own line, in this exact format:
[CONSENSUS: <level>]
Where <level> is one of:
- "Unanimous" — all workers conveyed the same meaning (even if worded differently)
- "Strong Agreement" — workers mostly agree with only minor differences in detail or phrasing
- "Partial Agreement" — workers agree on some points but differ on others
- "Divergent" — workers gave substantially different or contradictory responses`;

      const judgeStart = Date.now();
      const { text: rawJudge } = await withRetry(
        () =>
          generateText({
            model: judgeModel,
            system: judgePrompt + consensusSuffix,
            prompt: combinedContent,
            ...llmOpts,
          }),
        { maxAttempts: 3, baseDelayMs: 100 }
      );
      judgeLatency = (Date.now() - judgeStart) / 1000;

      // Parse [CONSENSUS: ...] — tolerant of missing ], quotes, trailing whitespace
      const consensusMatch = rawJudge.match(/\[CONSENSUS:\s*"?([^"\]\n]+)"?\]?\s*$/im);
      if (consensusMatch) {
        const level = consensusMatch[1].trim();
        const valid = ["Unanimous", "Strong Agreement", "Partial Agreement", "Divergent"];
        consensusType = valid.includes(level) ? level : "Partial Agreement";
        judgeOutput = rawJudge.slice(0, consensusMatch.index).trim();
      } else {
        consensusType = "Partial Agreement";
        judgeOutput = rawJudge.trim();
      }
    }

    const totalLatency = judgeLatency + Math.max(...workerResults.map((r) => r.latency));

    // Step 4 (optional): Quality scoring
    let qualityScores: number[] | undefined;
    if (enableQualityScoring) {
      try {
        const { text: qsText } = await withRetry(
          () =>
            generateText({
              model: judgeModel,
              system: `You are a quality assessor evaluating worker responses. Rate each worker on a scale of 1-10.

SCORING CRITERIA:
- Accuracy (does the response correctly address the original data?)
- Completeness (does it cover all relevant aspects?)
- Relevance (does it stay focused on the task?)
- Alignment with best answer (how close is it to the chosen judge output?)

RULES:
- If all workers gave the same answer, they should all receive the same score.
- A response that matches the judge's chosen answer closely should score higher.
- Deduct points for: factual errors, missing key information, off-topic content, unnecessary additions.
- Be consistent: similar quality responses should get similar scores.

Return ONLY valid JSON: {"quality_scores":[N,N,...]} where N is a decimal number between 1.0 and 10.0 (one decimal place, e.g. 6.5, 7.3, 9.0). No other text.`,
              prompt: `Original Data: ${userContent}\n\nWorker Responses:\n${workersFormatted}\n\nJudge's Chosen Answer:\n${judgeOutput}\n\nConsensus Level: ${consensusType}`,
              ...llmOpts,
            }),
          { maxAttempts: 2, baseDelayMs: 100 }
        );
        const clean = qsText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean) as { quality_scores: number[] };
        if (Array.isArray(parsed.quality_scores)) {
          // Normalize: workers with identical outputs must receive identical scores.
          // Group by normalized output text, average the judge's scores within each
          // group, and assign the group average to every member. This removes the
          // small judge-side variance that can drift otherwise-identical responses
          // by a point or two.
          const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
          const groups = new Map<string, number[]>();
          outputs.forEach((out, i) => {
            const key = normalize(out);
            const score = parsed.quality_scores[i];
            if (typeof score !== "number") return;
            const bucket = groups.get(key);
            if (bucket) bucket.push(score);
            else groups.set(key, [score]);
          });
          qualityScores = outputs.map((out, i) => {
            const bucket = groups.get(normalize(out));
            if (!bucket || bucket.length === 0) return parsed.quality_scores[i];
            const avg = bucket.reduce((a, b) => a + b, 0) / bucket.length;
            return Math.round(avg * 10) / 10;
          });
        }
      } catch {
        // non-fatal — skip quality scores on parse failure
      }
    }

    // Step 5 (optional): Judge reasoning — separate call for reliability
    if (includeReasoning && !allSame) {
      try {
        const { text: jrText } = await withRetry(
          () =>
            generateText({
              model: judgeModel,
              system: `You are a judge explaining your decision. Given the original data, the worker responses, and your chosen best answer, explain in one or two sentences why you chose this answer over the alternatives. Return ONLY the explanation, no labels or prefixes.`,
              prompt: `Original Data: ${userContent}\n\nWorker Responses:\n${workersFormatted}\n\nChosen Answer:\n${judgeOutput}`,
              ...llmOpts,
            }),
          { maxAttempts: 2, baseDelayMs: 100 }
        );
        judgeReasoning = jrText.trim() || "Could not generate reasoning";
      } catch {
        judgeReasoning = "Could not generate reasoning";
      }
    }

    // Step 6 (optional): Disagreement analysis
    let disagreementReason: string | undefined;
    if (enableDisagreementAnalysis && consensusType !== "Unanimous") {
      try {
        const { text: drText } = await withRetry(
          () =>
            generateText({
              model: judgeModel,
              system: `You are an expert analyst. In exactly one sentence, explain why the workers disagreed.`,
              prompt: `Original Data: ${userContent}\n\nWorker Responses:\n${workersFormatted}`,
              ...llmOpts,
            }),
          { maxAttempts: 2, baseDelayMs: 100 }
        );
        disagreementReason = drText.trim() || "Could not analyze disagreement";
      } catch {
        disagreementReason = "Could not analyze disagreement";
      }
    }

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
      kappaLabel: isNaN(kappa) ? "N/A" : kappa < 0.2 ? "Very Low" : kappa < 0.4 ? "Low" : kappa < 0.6 ? "Moderate" : kappa < 0.8 ? "High" : "Very High",
      agreementMatrix,
      ...(judgeReasoning !== undefined ? { judgeReasoning } : {}),
      ...(qualityScores !== undefined ? { qualityScores } : {}),
      ...(disagreementReason !== undefined ? { disagreementReason } : {}),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("consensus-row error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
