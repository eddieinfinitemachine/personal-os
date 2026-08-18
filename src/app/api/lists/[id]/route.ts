import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isListColor } from "@/lib/lists";
import { getCurrentUserId } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.list.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await request.json()) as {
    name?: string;
    color?: string;
    position?: number;
  };

  // A member (not the owner) can only personalize their own tile color —
  // it's stored on their ListMember row so the owner's color is untouched.
  if (existing.userId !== userId) {
    const membership = await prisma.listMember.findUnique({
      where: { listId_userId: { listId: id, userId } },
    });
    if (!membership) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (body.color === undefined || !isListColor(body.color)) {
      return NextResponse.json({ error: "only color can be changed on a shared list" }, { status: 400 });
    }
    await prisma.listMember.update({
      where: { id: membership.id },
      data: { color: body.color },
    });
    return NextResponse.json({ list: { ...existing, color: body.color } });
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    updates.name = name;
  }
  if (body.color !== undefined && isListColor(body.color)) updates.color = body.color;
  if (body.position !== undefined) updates.position = body.position;

  const list = await prisma.list.update({ where: { id }, data: updates });
  return NextResponse.json({ list });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const list = await prisma.list.findUnique({ where: { id } });
  if (!list) return NextResponse.json({ error: "not found" }, { status: 404 });

  // A member (not the owner) deleting a shared list only leaves it: their
  // ListMember row goes away, the list and its todos stay intact for the
  // owner and any other members.
  if (list.userId !== userId) {
    const membership = await prisma.listMember.findUnique({
      where: { listId_userId: { listId: id, userId } },
    });
    if (!membership) return NextResponse.json({ error: "not found" }, { status: 404 });
    await prisma.listMember.delete({ where: { id: membership.id } });
    return NextResponse.json({ ok: true, left: true });
  }

  if (list.isDefault) {
    return NextResponse.json({ error: "default lists cannot be deleted" }, { status: 400 });
  }
  await prisma.list.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
