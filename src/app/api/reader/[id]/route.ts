import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { KINDLE_USER_SELECT, kindleConfig, withReadingMeta } from "@/lib/reader-api";

// The article as JSON for the native app: what /reader/[id] renders, plus
// the Kindle state its send button needs.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const [item, user] = await Promise.all([
    prisma.readerItem.findFirst({
      where: { id, userId },
      select: {
        id: true,
        url: true,
        title: true,
        byline: true,
        siteName: true,
        excerpt: true,
        imageUrl: true,
        contentHtml: true,
        wordCount: true,
        savedAt: true,
        readAt: true,
        archivedAt: true,
        kindleSentAt: true,
        kindleError: true,
        highlights: {
          orderBy: { createdAt: "asc" },
          select: { id: true, text: true, note: true, createdAt: true },
        },
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: KINDLE_USER_SELECT }),
  ]);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(
    { item: withReadingMeta(item), kindle: kindleConfig(user) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.readerItem.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { read?: boolean; archived?: boolean } | null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  if (body?.read !== undefined) data.readAt = body.read ? new Date() : null;
  if (body?.archived !== undefined)
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
