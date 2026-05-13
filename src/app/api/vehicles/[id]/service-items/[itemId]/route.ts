import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
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
  const item = await prisma.serviceItem.update({ where: { id: itemId }, data: updates });
  return NextResponse.json({ item });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params;
  await prisma.serviceItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
