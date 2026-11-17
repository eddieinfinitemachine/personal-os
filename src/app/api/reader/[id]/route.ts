import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { KINDLE_USER_SELECT, kindleConfig, withReadingMeta } from "@/lib/reader-api";
import { readerHtmlToMarkdown } from "@/lib/reader-markdown";

// GET and PATCH answer the web and native apps (session) and EC Pad's Read
// Later sync (capture token); DELETE stays session-only. Every query is scoped
// to the resolved user, so another user's id reads as not found.
async function readerUser(request: Request): Promise<string | null> {
  return (await getCurrentUserId(request)) ?? (await resolveCaptureUser(request));
}

// The article as JSON: what /reader/[id] renders, plus the Kindle state the
// native app's send button needs, plus `markdown` (the article converted for
// EC Pad; "" when extraction failed).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await readerUser(request);
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
    {
      item: { ...withReadingMeta(item), markdown: readerHtmlToMarkdown(item.contentHtml, item.url) },
      kindle: kindleConfig(user),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await readerUser(request);
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
