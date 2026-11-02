import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { IMPROVEMENT_SELECT, toImprovementView } from "@/lib/improvements/request";

type Params = { params: Promise<{ id: string }> };

// Founder-only for the same reason as POST /api/improvements: approving lets
// the Mac worker merge to production, and both actions steer that worker.
async function founderId(request: Request): Promise<string | NextResponse> {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isFounderUser(userId))) {
    return NextResponse.json({ error: "Improvements aren't enabled for this account." }, { status: 403 });
  }
  return userId;
}

/** After a conditional write matched nothing: 404 if the row isn't the caller's, else 409. */
async function notApplicable(id: string, userId: string, conflict: string) {
  const exists = await prisma.improvement.findFirst({ where: { id, userId }, select: { id: true } });
  return exists
    ? NextResponse.json({ error: conflict }, { status: 409 })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}

/** Cancel a request the worker hasn't picked up yet. */
export async function DELETE(request: Request, { params }: Params) {
  const userId = await founderId(request);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const { count } = await prisma.improvement.deleteMany({ where: { id, userId, status: "queued" } });
  if (count === 0) return notApplicable(id, userId, "Only queued requests can be cancelled.");
  return NextResponse.json({ ok: true });
}

/** `{ action: "approve" }` ships a request the worker stopped at a PR for. */
export async function PATCH(request: Request, { params }: Params) {
  const userId = await founderId(request);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || (body as { action?: unknown }).action !== "approve") {
    return NextResponse.json({ error: 'action must be "approve"' }, { status: 400 });
  }

  const { id } = await params;
  const { count } = await prisma.improvement.updateMany({
    where: { id, userId, status: "needs_review" },
    data: { status: "approved", error: null },
  });
  if (count === 0) return notApplicable(id, userId, "Only requests waiting for review can be shipped.");

  const row = await prisma.improvement.findFirst({ where: { id, userId }, select: IMPROVEMENT_SELECT });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ improvement: toImprovementView(row) });
}
