import { NextResponse } from "next/server";
import { getFounderUser, isAuthorizedCron } from "@/lib/cron";
import { syncInferredProjects } from "@/lib/projects/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Every 3 hours: Claude infers what I'm working on from the last two weeks of
// meetings, sent email, todos and notes (ProjectSource kind "inferred"). The
// log line is counts only.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const founder = await getFounderUser();
  if (!founder) {
    console.error("projects-infer cron: founder user not found (FOUNDER_EMAIL)");
    return NextResponse.json({ error: "founder user not found" }, { status: 404 });
  }
  const result = await syncInferredProjects(founder.id);
  console.log("projects-infer cron", JSON.stringify(result));
  return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
}
