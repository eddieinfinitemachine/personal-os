import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Inferred cards on /projects can be pinned, hidden ("Not a project") or put
// back on auto. Nothing else.
const STATES = new Set(["auto", "pinned", "hidden"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { state?: unknown };
  const source = await prisma.projectSource.findUnique({ where: { id } });
  if (!source || source.userId !== userId || source.kind !== "inferred") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const state = typeof body.state === "string" ? body.state : "";
  if (!STATES.has(state)) {
    return NextResponse.json({ error: `can't set a project to "${state}"` }, { status: 400 });
  }

  const updated = await prisma.projectSource.update({
    where: { id },
    data: { state },
    select: { id: true, kind: true, state: true },
  });
  return NextResponse.json({ source: updated });
}
