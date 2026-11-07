import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const item = await prisma.readerItem.findFirst({
    where: { id, userId },
    select: {
      highlights: {
        orderBy: { createdAt: "asc" },
        select: { id: true, text: true, note: true, createdAt: true },
      },
    },
  });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(
    { highlights: item.highlights },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const item = await prisma.readerItem.findFirst({ where: { id, userId } });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { text?: unknown; note?: unknown } | null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const highlight = await prisma.highlight.create({
    data: { userId, itemId: id, text: text.slice(0, 2000), note: note || null },
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
  let body: { highlightId?: unknown } | null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const highlightId = typeof body?.highlightId === "string" ? body.highlightId : "";
  if (!highlightId)
    return NextResponse.json({ error: "highlightId required" }, { status: 400 });
  await prisma.highlight.deleteMany({
    where: { id: highlightId, userId, itemId: id },
  });
  return NextResponse.json({ ok: true });
}
