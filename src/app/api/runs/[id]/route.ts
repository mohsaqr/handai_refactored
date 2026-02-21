import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const run = await prisma.run.findUnique({
            where: { id },
        });

        if (!run) {
            return NextResponse.json({ error: "Run not found" }, { status: 404 });
        }

        const results = await prisma.runResult.findMany({
            where: { runId: id },
            orderBy: { rowIndex: "asc" }
        });

        return NextResponse.json({ run, results });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
