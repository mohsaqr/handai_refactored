import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { AgentsRowSchema } from "@/lib/validation";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AgentsRowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { agents, userContent, maxRounds, rowIdx, runId } = parsed.data;

    const nonReferees = agents.filter((a) => !a.isReferee);
    const referee = agents.find((a) => a.isReferee);
    if (!referee) {
      return NextResponse.json({ error: "No referee agent configured" }, { status: 400 });
    }

    // Parse userContent once (may be JSON for structured data)
    let parsedRow: Record<string, unknown> | null = null;
    try { parsedRow = JSON.parse(userContent); } catch { /* unstructured text */ }

    const negotiationLog: Array<{ round: number; agent: string; output: string }> = [];
    const latestOutputs: Record<string, string> = {};
    const totalLatencies: Record<string, number> = {};
    nonReferees.forEach((a) => { totalLatencies[a.name] = 0; });

    let converged = false;
    let roundsTaken = 0;

    for (let round = 1; round <= maxRounds; round++) {
      roundsTaken = round;
      const previousOutputs = { ...latestOutputs };

      const promises = nonReferees.map(async (agent) => {
        const model = getModel(agent.provider, agent.model, agent.apiKey || "local", agent.baseUrl);

        // Build user content: subset by columns if structured, else full text
        let agentContent: string;
        if (agent.columns && agent.columns.length > 0 && parsedRow) {
          const subset: Record<string, unknown> = {};
          agent.columns.forEach((col) => { subset[col] = parsedRow![col]; });
          agentContent = JSON.stringify(subset);
        } else {
          agentContent = userContent;
        }

        // For rounds 2+, append other agents' previous outputs
        if (round > 1) {
          const othersSection = Object.entries(previousOutputs)
            .filter(([name]) => name !== agent.name)
            .map(([name, output]) => `[${name}]:\n${output}`)
            .join("\n\n");
          agentContent += `\n\n--- Other agents' outputs from round ${round - 1} ---\n\n${othersSection}\n\n--- Refine your answer based on the above. ---`;
        }

        const start = Date.now();
        const { text } = await withRetry(
          () => generateText({ model, system: agent.role, prompt: agentContent }),
          { maxAttempts: 3, baseDelayMs: 100 }
        );
        return { name: agent.name, output: text.trim(), latency: (Date.now() - start) / 1000 };
      });

      const settled = await Promise.allSettled(promises);
      const results = settled
        .filter((r): r is PromiseFulfilledResult<{ name: string; output: string; latency: number }> => r.status === "fulfilled")
        .map((r) => r.value);

      if (results.length === 0) {
        const errors = settled
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
        return NextResponse.json(
          { error: `All agents failed in round ${round}: ${errors.join("; ")}` },
          { status: 502 }
        );
      }

      for (const r of results) {
        latestOutputs[r.name] = r.output;
        totalLatencies[r.name] = (totalLatencies[r.name] || 0) + r.latency;
        negotiationLog.push({ round, agent: r.name, output: r.output });
      }

      // Check convergence: all outputs same as previous round
      if (round > 1) {
        converged = results.every((r) => previousOutputs[r.name] === r.output);
        if (converged) break;
      }
    }

    // Referee round
    const agentsSummary = Object.entries(latestOutputs)
      .map(([name, output]) => `[${name}]:\n${output}`)
      .join("\n\n");
    const refereePrompt = `Original data:\n${userContent}\n\n--- Agent outputs (final round) ---\n\n${agentsSummary}`;

    const refereeModel = getModel(referee.provider, referee.model, referee.apiKey || "local", referee.baseUrl);
    const refStart = Date.now();
    const { text: refereeText } = await withRetry(
      () => generateText({ model: refereeModel, system: referee.role, prompt: refereePrompt }),
      { maxAttempts: 3, baseDelayMs: 100 }
    );
    const refereeLatency = (Date.now() - refStart) / 1000;

    const agentOutputs = nonReferees.map((a) => ({
      name: a.name,
      output: latestOutputs[a.name] || "",
      latency: totalLatencies[a.name] || 0,
    }));

    const totalLatency = refereeLatency + Math.max(...Object.values(totalLatencies), 0);

    if (runId) {
      await prisma.runResult.create({
        data: {
          runId,
          rowIndex: rowIdx ?? 0,
          inputJson: JSON.stringify({ content: userContent }),
          output: JSON.stringify({ agents: agentOutputs, referee: refereeText.trim(), rounds: roundsTaken, converged }),
          status: "SUCCESS",
          latency: totalLatency,
        },
      });
    }

    return NextResponse.json({
      agentOutputs,
      refereeOutput: refereeText.trim(),
      refereeLatency,
      negotiationLog,
      roundsTaken,
      converged,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("ai-agents-row error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
