import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { extractArticle, extractArticleFromHtml } from "@/lib/reader-extract";
import { sendReaderItemToKindle } from "@/lib/kindle";
import { kindleStatus } from "@/lib/kindle-status";

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
  return saveFromRequest(request);
}

// Shared by POST and GET-with-?url=. The share-sheet Shortcut's "Get contents
// of URL" action is a GET unless someone opens its hidden Method field, and
// for weeks it was saving nothing while showing "Saved" — so both verbs save.
async function saveFromRequest(request: Request): Promise<Response> {
  const userId = await resolveUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Shortcuts is loose about shape: the link may arrive as JSON {url} or
  // {text}, as a form field, as a raw text body, or in the query string, and
  // "Get URLs from Input" hands over a list. Take the first http(s) URL found
  // anywhere in that pile.
  const params = new URL(request.url).searchParams;
  const candidates: unknown[] = [params.get("url"), params.get("text")];
  let bodyPreview = "";
  if (request.method === "POST") {
    const text = await request.clone().text().catch(() => "");
    bodyPreview = text.slice(0, 200);
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      candidates.push(json?.url, json?.text, json?.link, json?.input);
    } catch {
      const form = new URLSearchParams(text);
      candidates.push(form.get("url"), form.get("text"), text);
    }
  }
  const raw = candidates
    .flatMap((c) => (Array.isArray(c) ? c : [c]))
    .filter((c): c is string => typeof c === "string")
    .map((c) => {
      // Query values are already decoded; bodies may carry an encoded URL.
      try { return /^https?%3A/i.test(c) ? decodeURIComponent(c) : c; } catch { return c; }
    })
    .join("\n");
  const match = raw.match(/https?:\/\/\S+/);
  if (!match) {
    console.warn("[reader] save without a URL", {
      method: request.method,
      contentType: request.headers.get("content-type"),
      ua: request.headers.get("user-agent"),
      query: Object.fromEntries(params),
      bodyPreview,
    });
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  const url = match[0];

  // Re-saving the same URL refreshes the extraction instead of duplicating.
  const existing = await prisma.readerItem.findFirst({
    where: { userId, url },
  });

  try {
    let a;
    if (request.method === "POST") {
      try {
        const text = await request.text();
        const json = JSON.parse(text);
        if (typeof json?.html === "string" && json.html.length <= 4_000_000) {
          try {
            a = await extractArticleFromHtml(url, json.html);
          } catch {
            a = await extractArticle(url);
          }
        } else {
          a = await extractArticle(url);
        }
      } catch {
        a = await extractArticle(url);
      }
    } else {
      a = await extractArticle(url);
    }

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

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { kindleEmail: true, kindleAutoSend: true } });
    const shouldAutoSend = user?.kindleEmail && user.kindleAutoSend && !item.kindleSentAt && item.contentHtml;
    const kindleState = shouldAutoSend ? "sending" : (item.kindleSentAt ? "already-sent" : "off");

    if (shouldAutoSend) {
      after(async () => {
        try {
          await sendReaderItemToKindle(item.id);
        } catch (e) {
          console.error("[reader] auto-send failed", { itemId: item.id, error: e });
        }
      });
    }

    const minutes = Math.max(1, Math.round(item.wordCount / 230));
    const messagePreview = kindleState === "sending" ? " · sending to Kindle" : "";
    return NextResponse.json({
      ok: true,
      id: item.id,
      title: item.title,
      minutes,
      kindle: kindleState,
      message: `Saved · ${minutes} min${messagePreview}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "extraction failed";
    const item = existing ?? (await prisma.readerItem.create({
      data: {
        userId,
        url,
        title: url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 120),
        excerpt: `Saved without reader view (${msg})`,
      },
    }));
    return NextResponse.json({ ok: true, id: item.id, degraded: true, kindle: "skipped", message: "Saved link only (no article text)" });
  }
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.has("url")) return saveFromRequest(request);
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
