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
    title?: string;
    link?: string | null;
    priceUsd?: number | null;
    quantity?: number | null;
    notes?: string | null;
    toggleComplete?: boolean;
  };

  const existing = await prisma.petShoppingItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title.trim();
  if (body.link !== undefined) updates.link = body.link?.trim() || null;
  if (body.priceUsd !== undefined) updates.priceUsd = body.priceUsd;
  if (body.quantity !== undefined) updates.quantity = body.quantity;
  if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
  if (body.toggleComplete) {
    updates.completedAt = existing.completedAt ? null : new Date();
  }

  const item = await prisma.petShoppingItem.update({
    where: { id: itemId },
    data: updates,
  });
  return NextResponse.json({ item });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { itemId } = await params;
  const existing = await prisma.petShoppingItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.petShoppingItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
