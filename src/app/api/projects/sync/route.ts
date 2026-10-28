import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { syncInferredProjects } from "@/lib/projects/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The /projects Refresh button: the 3-hourly inference, run now. Founder only;
// everyone else gets a 404, as if the route didn't exist.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId || !(await isFounderUser(userId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const result = await syncInferredProjects(userId);
  if (result.status === "busy") {
    return NextResponse.json({ error: "Already refreshing. Try again in a minute." }, { status: 409 });
  }
  if (result.status === "failed") {
    return NextResponse.json({ error: `Refresh failed (${result.error})` }, { status: 502 });
  }
  return NextResponse.json(result);
}
