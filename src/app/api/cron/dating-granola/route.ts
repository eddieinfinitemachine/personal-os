import { NextResponse } from "next/server";
import { getFounderUser, isAuthorizedCron } from "@/lib/cron";
import { prisma } from "@/lib/prisma";
import { syncGranolaIntake } from "@/lib/dating-intake/granola";
import { processSource } from "@/lib/dating-intake/extract";
import { syncGranola } from "@/lib/dating-granola";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily: file the last 10 days of Granola meetings (therapy, or ones that
// mention someone on /dating or a dating word) for the founder. Meetings
// already handled are skipped without a fetch or Claude call, so the overlap
// between days is free. Bigger backfills run from /dating ("Import since…").
const WINDOW_DAYS = 10;
const LIMIT = 6;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.GRANOLA_API_KEY?.trim()) {
    console.log("dating-granola cron: GRANOLA_API_KEY not set, nothing to do");
    return NextResponse.json({ skipped: "GRANOLA_API_KEY not set" });
  }
  const founder = await getFounderUser();
  if (!founder) {
    console.error("dating-granola cron: founder user not found (FOUNDER_EMAIL)");
    return NextResponse.json({ error: "founder user not found" }, { status: 404 });
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  try {
    const state = await prisma.datingSourceState.findFirst({ where: { userId: founder.id, source: "granola" } });
    if (state && !state.enabled && state.status !== "not_connected") return NextResponse.json({ skipped: "Granola intake is paused" });
    if (state?.enabled) {
      const intake = await syncGranolaIntake(founder.id, state.id);
      const processing = await processSource(founder.id, state.id);
      return NextResponse.json({ intake, processing });
    }
    const result = await syncGranola(founder.id, { since, limit: LIMIT });
    console.log("dating-granola cron", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("dating-granola cron failed:", error);
    return NextResponse.json({ error }, { status: 502 });
  }
}
