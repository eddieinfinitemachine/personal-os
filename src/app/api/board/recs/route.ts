import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { MIN_ITEMS_FOR_RECS, STALE_RUN_MS, generateRecs, startRecsRun } from "@/lib/board-recs";

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
  // A run whose function was killed never writes its own failure; report it
  // here so the UI stops waiting (the next POST reclaims it).
  const dead =
    taste?.status === "generating" && (!taste.startedAt || Date.now() - taste.startedAt.getTime() > STALE_RUN_MS);
  return NextResponse.json({
    taste: taste
      ? {
          profile: taste.profile,
          status: dead ? "error" : taste.status,
          error: dead ? "That took too long. Try again." : taste.error,
          generatedAt: taste.generatedAt,
        }
      : null,
    recs,
    boardCount,
    minItems: MIN_ITEMS_FOR_RECS,
  });
}

// Kick off a fresh batch, or with { seedId } a "More like this" batch for one
// board item. Returns right away; the client polls GET.
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
  // Optional { seedId }: "More like this" for one board item.
  const { seedId } = (await request.json().catch(() => ({}))) as { seedId?: unknown };
  let seedItemId: string | undefined;
  if (typeof seedId === "string" && seedId) {
    const seed = await prisma.boardItem.findFirst({ where: { id: seedId, userId }, select: { id: true } });
    if (!seed) return NextResponse.json({ error: "not found" }, { status: 404 });
    seedItemId = seed.id;
  }
  const claimed = await startRecsRun(userId);
  if (claimed) after(() => generateRecs(userId, { seedItemId }));
  return NextResponse.json({ ok: true, status: "generating", alreadyRunning: !claimed });
}
