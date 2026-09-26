import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { MIN_ITEMS_FOR_RECS, generateRecs, startRecsRun } from "@/lib/board-recs";

export const dynamic = "force-dynamic";
// Generation (web search + link resolution) runs in after() and can take a
// couple of minutes.
export const maxDuration = 300;

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [taste, recs, boardCount] = await Promise.all([
    prisma.boardTaste.findUnique({ where: { userId } }),
    prisma.boardRec.findMany({
      where: { userId, status: { in: ["new", "saved"] } },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    prisma.boardItem.count({ where: { userId } }),
  ]);
  return NextResponse.json({
    taste: taste
      ? { profile: taste.profile, status: taste.status, error: taste.error, generatedAt: taste.generatedAt }
      : null,
    recs,
    boardCount,
    minItems: MIN_ITEMS_FOR_RECS,
  });
}

// Kick off a fresh batch. Returns right away; the client polls GET.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const count = await prisma.boardItem.count({ where: { userId } });
  if (count < MIN_ITEMS_FOR_RECS) {
    return NextResponse.json(
      { error: `Save at least ${MIN_ITEMS_FOR_RECS} things to your board first.` },
      { status: 400 },
    );
  }
  const claimed = await startRecsRun(userId);
  if (claimed) after(() => generateRecs(userId));
  return NextResponse.json({ ok: true, status: "generating", alreadyRunning: !claimed });
}
