import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { syncGithubProjects } from "@/lib/projects/github";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The /projects Refresh button: the hourly GitHub sync, run now. Founder only;
// everyone else gets a 404, as if the route didn't exist.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId || !(await isFounderUser(userId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!process.env.GITHUB_TOKEN?.trim()) {
    return NextResponse.json({ error: "GITHUB_TOKEN not set" }, { status: 400 });
  }
  try {
    return NextResponse.json(await syncGithubProjects(userId));
  } catch (e) {
    const status = (e as { status?: number }).status;
    console.error("projects sync failed:", status ? `HTTP ${status}` : e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "GitHub sync failed" }, { status: 502 });
  }
}
