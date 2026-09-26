import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { backfillTags } from "@/lib/board-tags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Tag the current user's untagged items (the board fires this on open, so an
// existing board gets categorized just by visiting it). Sequential and capped
// per call; stops early near the function deadline.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { tagged, remaining } = await backfillTags(session.userId, { limit: 40, deadline: Date.now() + 240_000 });
  return NextResponse.json({ tagged, remaining });
}
