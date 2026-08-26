import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { itemId } = await params;
  const existing = await prisma.packingItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await request.json()) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) {
    data.title = body.title.trim();
  }
  if (typeof body.category === "string" && body.category.trim()) {
    data.category = body.category.trim();
  }
  if (typeof body.quantity === "number" && body.quantity >= 1) {
    data.quantity = Math.min(Math.round(body.quantity), 99);
  }
  if (body.notes !== undefined) {
    data.notes = typeof body.notes === "string" ? body.notes : null;
  }
  if (typeof body.position === "number") data.position = body.position;
  if (body.togglePacked) {
    data.packedAt = existing.packedAt ? null : new Date();
  } else if (typeof body.packed === "boolean") {
    data.packedAt = body.packed ? existing.packedAt ?? new Date() : null;
  }

  const item = await prisma.packingItem.update({ where: { id: itemId }, data });
  return NextResponse.json({ item });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { itemId } = await params;
  const existing = await prisma.packingItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.packingItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
