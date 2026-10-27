import { NextResponse } from "next/server";
import { getFounderUser, isAuthorizedCron } from "@/lib/cron";
import { syncGithubProjects } from "@/lib/projects/github";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Hourly: GitHub repos with commits I authored in 90 days become /projects
// cards (ProjectSource kind "repo"), with their tasks/todo.md as the plan.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.GITHUB_TOKEN?.trim()) {
    console.log("projects-github cron: GITHUB_TOKEN not set, nothing to do");
    return NextResponse.json({ skipped: "GITHUB_TOKEN not set" });
  }
  const founder = await getFounderUser();
  if (!founder) {
    console.error("projects-github cron: founder user not found (FOUNDER_EMAIL)");
    return NextResponse.json({ error: "founder user not found" }, { status: 404 });
  }
  try {
    const body = await syncGithubProjects(founder.id);
    console.log("projects-github cron", JSON.stringify(body));
    return NextResponse.json(body);
  } catch (e) {
    const status = (e as { status?: number }).status;
    const error = e instanceof Error ? e.message : String(e);
    console.error("projects-github cron: sync failed:", status ? `HTTP ${status}` : error);
    return NextResponse.json({ error }, { status: 502 });
  }
}
