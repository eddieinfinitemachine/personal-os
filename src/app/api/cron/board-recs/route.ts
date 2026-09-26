import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/cron";
import { MIN_ITEMS_FOR_RECS, generateRecs, startRecsRun } from "@/lib/board-recs";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Weekly fresh picks for everyone whose board has something to go on and
// whose last batch is at least 6 days old. A few users per run keeps us
// inside the function time limit; runs happen in parallel.
const USERS_PER_RUN = 4;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const cutoff = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  const groups = await prisma.boardItem.groupBy({
    by: ["userId"],
    _count: { _all: true },
    _max: { savedAt: true },
  });
  const eligible = groups.filter((g) => g._count._all >= MIN_ITEMS_FOR_RECS).map((g) => g.userId);
  const tastes = await prisma.boardTaste.findMany({ where: { userId: { in: eligible } } });
  const last = new Map(tastes.map((t) => [t.userId, t.generatedAt]));
  const due = eligible
    .filter((id) => !last.get(id) || last.get(id)! < cutoff)
    .sort((a, b) => (last.get(a)?.getTime() ?? 0) - (last.get(b)?.getTime() ?? 0))
    .slice(0, USERS_PER_RUN);

  const results = await Promise.all(
    due.map(async (userId) => {
      if (!(await startRecsRun(userId))) return { userId, count: 0, skipped: true };
      const count = await generateRecs(userId);
      if (count > 0) {
        await sendPushToUser(userId, {
          title: `${count} new picks for you`,
          body: "Fresh finds based on your board.",
          url: "/board?view=for-you",
          tag: "board-recs",
        }).catch(() => 0);
      }
      return { userId, count };
    }),
  );
  return NextResponse.json({ ok: true, results });
}
