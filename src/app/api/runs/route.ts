import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { RunCreateSchema } from "@/lib/validation";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10);

    const [runs, total] = await Promise.all([
      prisma.run.findMany({
        orderBy: { startedAt: "desc" },
        take: limit,
        skip: offset,
        include: { _count: { select: { results: true } } },
      }),
      prisma.run.count(),
    ]);

    return NextResponse.json({ runs, total, limit, offset });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RunCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    let sessionId = data.sessionId;
    if (!sessionId) {
      const session = await prisma.session.create({
        data: {
          name: `Session ${new Date().toLocaleDateString()}`,
          mode: data.runType,
          settingsJson: "{}",
        },
      });
      sessionId = session.id;
    }

    const run = await prisma.run.create({
      data: {
        sessionId,
        runType: data.runType,
        provider: data.provider,
        model: data.model,
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 2048,
        systemPrompt: data.systemPrompt ?? "",
        schemaJson: data.schemaJson ?? "{}",
        variablesJson: data.variablesJson ?? "{}",
        inputFile: data.inputFile,
        inputRows: data.inputRows,
        status: "processing",
        jsonMode: data.jsonMode ?? false,
        maxConcurrency: data.maxConcurrency ?? 5,
      },
    });

    return NextResponse.json(run);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Create Run Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
