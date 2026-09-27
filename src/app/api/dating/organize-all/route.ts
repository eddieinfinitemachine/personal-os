import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { organizeBatch, pendingOrganize } from "@/lib/dating-organize";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Organize everyone's notes with Claude, a few people per request (they run in
// parallel, so a batch takes about one Claude call). The Granola card on
// /dating loops until `remaining` is 0, passing back the ids that failed so
// they aren't retried in the same run.
// GET  → { remaining }
// POST { skip?: string[], today?: "YYYY-MM-DD" } → { done, remaining, results, failed }

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ remaining: (await pendingOrganize(userId)).length });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { skip?: unknown; today?: unknown };
  const skip = Array.isArray(body.skip)
    ? body.skip.filter((s): s is string => typeof s === "string").slice(0, 500)
    : [];
  return NextResponse.json(await organizeBatch(userId, skip, body.today));
}
