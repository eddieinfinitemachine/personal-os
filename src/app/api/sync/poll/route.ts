import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";

// Lightweight polling endpoint. Returns the max `updatedAt` of any Todo in
// a list the current user can access. Client-side `useSyncPoll` calls this
// every ~1.5s while the tab is visible; if `latestAt` advances since the
// last poll, the page calls `router.refresh()`.
//
// The aggregate uses the (listId, completedAt, position) index via the
// `list: listAccessWhere(userId)` predicate — cheap enough that running it
// per-active-user every 1.5s is well within budget for this app.
export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const max = await prisma.todo.aggregate({
    where: { list: listAccessWhere(userId) },
    _max: { updatedAt: true },
  });
  return NextResponse.json(
    { latestAt: max._max.updatedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
