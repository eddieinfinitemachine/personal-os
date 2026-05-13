import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.recommendation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
