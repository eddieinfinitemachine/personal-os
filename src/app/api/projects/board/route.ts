import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { getProjectsBoard } from "@/lib/projects/board";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

/**
 * The /projects board for the native app, from the page's own loader: the
 * shown, hidden and finished buckets in the page's order, with each card's
 * full steps and problem line. Founder only, like the board itself and
 * POST /api/projects/sync; anyone else gets 404.
 */
export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  if (!(await isFounderUser(userId))) return NextResponse.json({ error: "not found" }, { status: 404, headers });
  return NextResponse.json(await getProjectsBoard(userId, true), { headers });
}
