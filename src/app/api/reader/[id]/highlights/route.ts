import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const item = await prisma.readerItem.findFirst({ where: { id, userId } });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await request.json()) as { text?: string; note?: string };
  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  const highlight = await prisma.highlight.create({
    data: { userId, itemId: id, text: text.slice(0, 2000), note: body.note?.trim() || null },
  });
  return NextResponse.json({ highlight });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json()) as { highlightId?: string };
  if (!body.highlightId)
    return NextResponse.json({ error: "highlightId required" }, { status: 400 });
  await prisma.highlight.deleteMany({
    where: { id: body.highlightId, userId, itemId: id },
  });
  return NextResponse.json({ ok: true });
}
