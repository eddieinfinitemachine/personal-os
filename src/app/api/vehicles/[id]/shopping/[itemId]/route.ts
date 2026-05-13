import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params;
  const body = (await request.json()) as {
    title?: string;
    link?: string | null;
    priceUsd?: number | null;
    quantity?: number | null;
    notes?: string | null;
    toggleComplete?: boolean;
  };

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title.trim();
  if (body.link !== undefined) updates.link = body.link?.trim() || null;
  if (body.priceUsd !== undefined) updates.priceUsd = body.priceUsd;
  if (body.quantity !== undefined) updates.quantity = body.quantity;
  if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
  if (body.toggleComplete) {
    const existing = await prisma.shoppingItem.findUnique({ where: { id: itemId } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    updates.completedAt = existing.completedAt ? null : new Date();
  }

  const item = await prisma.shoppingItem.update({ where: { id: itemId }, data: updates });
  return NextResponse.json({ item });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params;
  await prisma.shoppingItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
