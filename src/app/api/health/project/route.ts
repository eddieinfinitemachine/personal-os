import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { findHealthProjectId } from "@/lib/health/load";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

/** The person's Health project id (or null), for the app's calls to /api/projects/[id]/ask and /picture. */
export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  try {
    return NextResponse.json({ projectId: await findHealthProjectId(userId) }, { headers });
  } catch {
    console.error("health project lookup failed");
    return NextResponse.json({ error: "Could not find your health record. Try again." }, { status: 500, headers });
  }
}
