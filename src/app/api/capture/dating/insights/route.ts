import { NextResponse } from "next/server";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { refreshDatingInsights } from "@/lib/dating-insights";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Mac sync calls once per person after both message sources, including runs
// with no new messages so a prior failed generation can retry.
export async function POST(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized", refreshed: false }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const personId = body && typeof body === "object" && "personId" in body ? body.personId : undefined;
  if (typeof personId !== "string" || !personId.trim() || personId.length > 200) {
    return NextResponse.json({ error: "personId required", refreshed: false }, { status: 400 });
  }
  try {
    const result = await refreshDatingInsights(userId, personId, { onlyIfStale: true });
    if (!result.ok) return NextResponse.json({ error: result.error, refreshed: false }, { status: result.status });
    return NextResponse.json({
      personId: result.person.id, refreshed: result.refreshed, reason: result.reason,
      insightsAt: result.person.insightsAt?.toISOString() ?? null, sources: result.sources,
    });
  } catch {
    console.error("dating capture insights refresh failed");
    return NextResponse.json({ error: "Could not refresh this summary; try again", refreshed: false }, { status: 502 });
  }
}
