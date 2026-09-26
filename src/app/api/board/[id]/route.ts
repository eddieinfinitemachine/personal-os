import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { deleteBoardImage } from "@/lib/board";
import { BOARD_KINDS, type BoardKind } from "@/lib/board-embed";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const data: { note?: string | null; title?: string | null; kind?: BoardKind } = {};
  if ("note" in body) data.note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 4000) : null;
  if ("title" in body) data.title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 300) : null;
  if (typeof body.kind === "string" && (BOARD_KINDS as string[]).includes(body.kind)) data.kind = body.kind as BoardKind;

  const res = await prisma.boardItem.updateMany({ where: { id, userId }, data });
  if (res.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const item = await prisma.boardItem.findUnique({ where: { id } });
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const item = await prisma.boardItem.findFirst({ where: { id, userId } });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.boardItem.delete({ where: { id } });
  await deleteBoardImage(item.imageUrl);
  return NextResponse.json({ ok: true });
}
