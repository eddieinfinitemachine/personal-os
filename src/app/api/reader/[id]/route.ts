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
  const existing = await prisma.readerItem.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await request.json()) as {
    read?: boolean;
    archived?: boolean;
  };
  const data: Record<string, unknown> = {};
  if (body.read !== undefined) data.readAt = body.read ? new Date() : null;
  if (body.archived !== undefined)
    data.archivedAt = body.archived ? new Date() : null;
  const item = await prisma.readerItem.update({ where: { id }, data });
  return NextResponse.json({ item: { id: item.id, readAt: item.readAt, archivedAt: item.archivedAt } });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.readerItem.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.readerItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
