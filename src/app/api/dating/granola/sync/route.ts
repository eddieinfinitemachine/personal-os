import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { syncGranola } from "@/lib/dating-granola";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// One Granola sync batch for the signed-in founder (the API key is personal,
// so nobody else can use it). POST { since?: "YYYY-MM-DD" | ISO timestamp }
// (default: 10 days ago). The /dating "Granola" control loops, passing back
// `nextSince`, until `remaining` is 0.
// → { processed, filed, suggestions, skipped, remaining, meetings, errors, nextSince }

const DEFAULT_DAYS = 10;

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isFounderUser(userId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.GRANOLA_API_KEY?.trim()) {
    return NextResponse.json({ error: "GRANOLA_API_KEY not set" }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { since?: unknown };
  let since = new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);
  if (body.since !== undefined && body.since !== null && body.since !== "") {
    const raw = typeof body.since === "string" ? body.since.trim() : "";
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : new Date(raw);
    if (!raw || Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return NextResponse.json({ error: "since must be YYYY-MM-DD" }, { status: 400 });
    }
    since = parsed;
  }

  try {
    return NextResponse.json(await syncGranola(userId, { since }));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("granola sync failed:", error);
    return NextResponse.json({ error }, { status: 502 });
  }
}
