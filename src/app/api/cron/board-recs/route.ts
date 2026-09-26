import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/cron";
import { MIN_ITEMS_FOR_RECS, generateRecs, startRecsRun } from "@/lib/board-recs";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Weekly fresh picks for everyone whose board has something to go on and
// whose last batch is at least 6 days old.
//
// One run can take most of a function's 300 s, so the scheduled call only
// finds who is due and fans out one request per user (?user=<id>); each of
// those claims the run, returns, and generates in its own after().
const MAX_USERS = 25;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const one = url.searchParams.get("user");
  if (one) return runForUser(one);

  const cutoff = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  const groups = await prisma.boardItem.groupBy({ by: ["userId"], _count: { _all: true } });
  const eligible = groups.filter((g) => g._count._all >= MIN_ITEMS_FOR_RECS).map((g) => g.userId);
  const tastes = await prisma.boardTaste.findMany({ where: { userId: { in: eligible } } });
  const last = new Map(tastes.map((t) => [t.userId, t.generatedAt]));
  const due = eligible
    .filter((id) => !last.get(id) || last.get(id)! < cutoff)
    .sort((a, b) => (last.get(a)?.getTime() ?? 0) - (last.get(b)?.getTime() ?? 0))
    .slice(0, MAX_USERS);

  const auth = request.headers.get("authorization");
  const results = await Promise.allSettled(
    due.map(async (userId) => {
      const target = new URL(url.pathname, url.origin);
      target.searchParams.set("user", userId);
      const res = await fetch(target, { headers: auth ? { authorization: auth } : {} });
      return { userId, status: res.status, ...((await res.json().catch(() => ({}))) as object) };
    }),
  );
  return NextResponse.json({
    ok: true,
    results: results.map((r) => (r.status === "fulfilled" ? r.value : { error: String(r.reason) })),
  });
}

async function runForUser(userId: string) {
  if (!(await startRecsRun(userId))) return NextResponse.json({ started: false, reason: "already running" });
  after(async () => {
    const count = await generateRecs(userId);
    if (count > 0) {
      await sendPushToUser(userId, {
        title: `${count} new picks for you`,
        body: "Fresh finds based on your board.",
        url: "/board?view=for-you",
        tag: "board-recs",
      }).catch(() => 0);
    }
  });
  return NextResponse.json({ started: true });
}
