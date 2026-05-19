import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.recommendation.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await request.json()) as {
    completed?: boolean;
    dismissed?: boolean;
  };
  const updates: Record<string, unknown> = {};
  if (body.completed !== undefined) {
    updates.completedAt = body.completed ? new Date() : null;
  }
  if (body.dismissed !== undefined) {
    updates.dismissedAt = body.dismissed ? new Date() : null;
  }
  const rec = await prisma.recommendation.update({ where: { id }, data: updates });
  return NextResponse.json({ recommendation: rec });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.recommendation.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.recommendation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
