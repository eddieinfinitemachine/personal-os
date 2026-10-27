import { NextResponse } from "next/server";
import { getFounderUser, isAuthorizedCron } from "@/lib/cron";
import { isGoogleConfigured } from "@/lib/google";
import { syncMeetingProjects } from "@/lib/projects/meetings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Every 2 hours: the last 14 days of meetings (Google Calendar + Granola) are
// filed onto /projects cards, and recurring unmatched topics become
// Suggested cards. Runs with whichever source is configured.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const hasGranola = !!process.env.GRANOLA_API_KEY?.trim();
  if (!hasGranola && !isGoogleConfigured()) {
    console.log("projects-meetings cron: neither GRANOLA_API_KEY nor Google credentials set, nothing to do");
    return NextResponse.json({ skipped: "GRANOLA_API_KEY and Google credentials not set" });
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.log("projects-meetings cron: ANTHROPIC_API_KEY not set, nothing to do");
    return NextResponse.json({ skipped: "ANTHROPIC_API_KEY not set" });
  }
  const founder = await getFounderUser();
  if (!founder) {
    console.error("projects-meetings cron: founder user not found (FOUNDER_EMAIL)");
    return NextResponse.json({ error: "founder user not found" }, { status: 404 });
  }
  try {
    const body = await syncMeetingProjects(founder.id);
    // Counts only: topic names stay out of the logs.
    const { topicsCreated, topicsSuggested, ...counts } = body;
    console.log(
      "projects-meetings cron",
      JSON.stringify({ ...counts, topicsCreated: topicsCreated.length, topicsSuggested: topicsSuggested.length }),
    );
    return NextResponse.json(body);
  } catch (e) {
    const status = (e as { status?: number }).status;
    const error = e instanceof Error ? e.message : String(e);
    console.error("projects-meetings cron: sync failed:", status ? `HTTP ${status}` : error);
    return NextResponse.json({ error }, { status: 502 });
  }
}
