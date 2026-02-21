import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResultsBatchSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ResultsBatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { runId, results } = parsed.data;

    // Wrap in transaction to prevent partial saves
    const [createdResults] = await prisma.$transaction([
      prisma.runResult.createMany({
        data: results.map((r) => ({
          runId,
          rowIndex: r.rowIndex,
          inputJson: JSON.stringify(r.input),
          output: typeof r.output === "string" ? r.output : JSON.stringify(r.output),
          status: r.status ?? "success",
          latency: r.latency ?? 0,
          errorType: r.errorType,
          errorMessage: r.errorMessage,
        })),
      }),
      prisma.run.update({
        where: { id: runId },
        data: {
          status: "completed",
          completedAt: new Date(),
          successCount: results.filter((r) => r.status !== "error").length,
          errorCount: results.filter((r) => r.status === "error").length,
          avgLatency:
            results.length > 0
              ? results.reduce((acc, r) => acc + (r.latency ?? 0), 0) / results.length
              : 0,
        },
      }),
    ]);

    return NextResponse.json({ count: createdResults.count, success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Batch Save Results Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
