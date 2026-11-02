import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { IMPROVEMENT_SELECT, parseImprovementInput, toImprovementView } from "@/lib/improvements/request";

export const dynamic = "force-dynamic";

/** The dialog shows the latest 10; a few extra cover requests cancelled meanwhile. */
const RECENT_LIMIT = 20;

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await prisma.improvement.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: IMPROVEMENT_SELECT,
    take: RECENT_LIMIT,
  });
  return NextResponse.json({ improvements: rows.map(toImprovementView) });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Improvements are implemented by Claude Code on Eddie's Mac with full
  // permissions and can be merged straight to production, so only the founder
  // may queue one (the worker also only claims the founder's requests).
  if (!(await isFounderUser(userId))) {
    return NextResponse.json({ error: "Improvements aren't enabled for this account." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = parseImprovementInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const row = await prisma.improvement.create({
    data: { userId, request: parsed.request, context: parsed.context ?? Prisma.DbNull, status: "queued" },
    select: IMPROVEMENT_SELECT,
  });
  return NextResponse.json({ improvement: toImprovementView(row) });
}
