import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { extractArticle } from "@/lib/reader-extract";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Save a link to Read Later. Two auth paths:
//  - session cookie (in-app paste)
//  - Bearer CAPTURE_TOKEN (the iOS share-sheet Shortcut) → founder account
async function resolveUserId(request: Request): Promise<string | null> {
  const sessionUser = await getCurrentUserId(request);
  if (sessionUser) return sessionUser;
  const secret = process.env.CAPTURE_TOKEN;
  const auth = request.headers.get("authorization");
  const url = new URL(request.url);
  const tokenOk =
    secret &&
    (auth === `Bearer ${secret}` || url.searchParams.get("token") === secret);
  if (!tokenOk && !(secret === undefined && process.env.NODE_ENV !== "production"))
    return null;
  const founder = await prisma.user.findUnique({
    where: { email: process.env.FOUNDER_EMAIL ?? "emcohen@me.com" },
  });
  return founder?.id ?? null;
}

export async function POST(request: Request) {
  const userId = await resolveUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    text?: string; // Shortcuts sometimes hand over the URL as plain text
  };
  const qsUrl = new URL(request.url).searchParams.get("url");
  const raw = (body.url ?? body.text ?? qsUrl ?? "").trim();
  const match = raw.match(/https?:\/\/\S+/);
  if (!match) return NextResponse.json({ error: "url required" }, { status: 400 });
  const url = match[0];

  // Re-saving the same URL refreshes the extraction instead of duplicating.
  const existing = await prisma.readerItem.findFirst({
    where: { userId, url },
  });

  try {
    const a = await extractArticle(url);
    const data = {
      title: a.title,
      byline: a.byline,
      siteName: a.siteName,
      excerpt: a.excerpt,
      imageUrl: a.imageUrl,
      contentHtml: a.contentHtml,
      wordCount: a.wordCount,
      archivedAt: null,
    };
    const item = existing
      ? await prisma.readerItem.update({ where: { id: existing.id }, data })
      : await prisma.readerItem.create({ data: { userId, url, ...data } });
    return NextResponse.json({
      ok: true,
      id: item.id,
      title: item.title,
      minutes: Math.max(1, Math.round(item.wordCount / 230)),
    });
  } catch (e) {
    // Extraction failed — still save the bare link so nothing shared is lost.
    const msg = e instanceof Error ? e.message : "extraction failed";
    const item =
      existing ??
      (await prisma.readerItem.create({
        data: {
          userId,
          url,
          title: url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 120),
          excerpt: `Saved without reader view (${msg})`,
        },
      }));
    return NextResponse.json({ ok: true, id: item.id, degraded: true });
  }
}

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const archived = new URL(request.url).searchParams.get("archived") === "1";
  const items = await prisma.readerItem.findMany({
    where: { userId, archivedAt: archived ? { not: null } : null },
    orderBy: { savedAt: "desc" },
    select: {
      id: true,
      url: true,
      title: true,
      byline: true,
      siteName: true,
      excerpt: true,
      imageUrl: true,
      wordCount: true,
      savedAt: true,
      readAt: true,
      _count: { select: { highlights: true } },
    },
    take: 200,
  });
  return NextResponse.json({ items });
}
