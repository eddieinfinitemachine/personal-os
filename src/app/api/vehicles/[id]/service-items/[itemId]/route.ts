import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { itemId } = await params;
  const body = (await request.json()) as {
    name?: string;
    intervalMonths?: number | null;
    intervalMileage?: number | null;
    notes?: string | null;
    lastPerformedAt?: string | null;
    lastPerformedMileage?: number | null;
  };
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.intervalMonths !== undefined) updates.intervalMonths = body.intervalMonths;
  if (body.intervalMileage !== undefined) updates.intervalMileage = body.intervalMileage;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.lastPerformedAt !== undefined) {
    updates.lastPerformedAt = body.lastPerformedAt
      ? new Date(body.lastPerformedAt)
      : null;
  }
  if (body.lastPerformedMileage !== undefined) {
    updates.lastPerformedMileage = body.lastPerformedMileage;
  }

  const existing = await prisma.serviceItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const item = await prisma.serviceItem.update({ where: { id: itemId }, data: updates });
  return NextResponse.json({ item });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { itemId } = await params;
  const result = await prisma.serviceItem.deleteMany({
    where: { id: itemId, userId },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
