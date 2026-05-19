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
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await request.json()) as {
    name?: string;
    color?: string;
    position?: number;
  };

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
  if (!list || list.userId !== userId) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (list.isDefault) {
    return NextResponse.json({ error: "default lists cannot be deleted" }, { status: 400 });
  }
  await prisma.list.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
