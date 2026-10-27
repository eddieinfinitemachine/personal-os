import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Repo cards can be pinned, hidden or put back on auto; a candidate or
// suggested topic can be dismissed (never suggested again). Nothing else.
const REPO_STATES = new Set(["auto", "pinned", "hidden"]);
const DISMISSABLE = new Set(["candidate", "suggested"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { state?: unknown };
  const source = await prisma.projectSource.findUnique({ where: { id } });
  if (!source || source.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const state = typeof body.state === "string" ? body.state : "";
  const allowed =
    source.kind === "repo"
      ? REPO_STATES.has(state)
      : source.kind === "topic" && state === "dismissed" && DISMISSABLE.has(source.state);
  if (!allowed) {
    return NextResponse.json({ error: `can't set ${source.kind} to "${state}"` }, { status: 400 });
  }

  const updated = await prisma.projectSource.update({
    where: { id },
    data: { state },
    select: { id: true, kind: true, state: true },
  });
  return NextResponse.json({ source: updated });
}
