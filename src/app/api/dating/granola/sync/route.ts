import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { IntakeError } from "@/lib/dating-intake/contracts";
import { prisma } from "@/lib/prisma";
import { syncGranolaIntake } from "@/lib/dating-intake/granola";
import { processSource } from "@/lib/dating-intake/extract";
import { syncGranola } from "@/lib/dating-granola";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// One Granola sync batch for the signed-in founder (the API key is personal,
// so nobody else can use it). POST { since?: "YYYY-MM-DD" | ISO timestamp }
// (default: 10 days ago). The /dating "Granola" control loops, passing back
// `nextSince` and `nextAfterId` as since/afterId, until `remaining` is 0.
// → { processed, filed, suggestions, skipped, remaining, meetings, errors, nextSince, nextAfterId }

const DEFAULT_DAYS = 10;

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isFounderUser(userId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.GRANOLA_API_KEY?.trim()) {
    return NextResponse.json({ error: "GRANOLA_API_KEY not set" }, { status: 503 });
  }

  const rawBody: unknown = await request.json().catch(() => ({}));
  const body = (rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? rawBody : {}) as {
    since?: unknown; afterId?: unknown;
  };
  let since = new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);
  if (body.since !== undefined && body.since !== null && body.since !== "") {
    const raw = typeof body.since === "string" ? body.since.trim() : "";
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : new Date(raw);
    if (!raw || Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return NextResponse.json({ error: "since must be YYYY-MM-DD" }, { status: 400 });
    }
    since = parsed;
  }

  const afterId = typeof body.afterId === "string" ? body.afterId.trim() : undefined;
  if (body.afterId != null && (!afterId || afterId.length > 120)) {
    return NextResponse.json({ error: "afterId must be a meeting id" }, { status: 400 });
  }
  if (afterId && !body.since) {
    return NextResponse.json({ error: "afterId requires since" }, { status: 400 });
  }

  try {
    const state = await prisma.datingSourceState.findFirst({ where: { userId, source: "granola" } });
    if (state && !state.enabled && state.status !== "not_connected") return NextResponse.json({ error: "Granola intake is paused. Resume it in Imports and sync first." }, { status: 409 });
    if (state?.enabled) {
      const intake = await syncGranolaIntake(userId, state.id, { since });
      const processing = await processSource(userId, state.id);
      return NextResponse.json({ durable: true, processed: intake.attempted, filed: 0, suggestions: 0, remaining: processing.backlog, errors: [], nextSince: since.toISOString(), nextAfterId: null });
    }
    return NextResponse.json(await syncGranola(userId, { since, afterId }));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("Granola sync could not finish");
    return NextResponse.json({ error: e instanceof IntakeError ? error : "Granola could not finish. Try again or check source status." }, { status: e instanceof IntakeError ? e.status : 502 });
  }
}
