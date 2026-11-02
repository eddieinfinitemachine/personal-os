import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import {
  extractArticle,
  extractArticleFromHtml,
  type ExtractedArticle,
} from "@/lib/reader-extract";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { findCaptureReplay, quickSource, withCaptureReview } from "@/lib/capture-review/record";
import { intakeMeta } from "@/lib/capture-review/intake";
import { CaptureReviewError } from "@/lib/capture-review/types";
import { sendReaderItemToKindle } from "@/lib/kindle-send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return saveFromRequest(request);
}

// Shared by POST and GET-with-?url=. The share-sheet Shortcut's "Get contents
// of URL" action is a GET unless someone opens its hidden Method field, and
// for weeks it was saving nothing while showing "Saved" — so both verbs save.
async function saveFromRequest(request: Request): Promise<Response> {
  const sessionUser = await getCurrentUserId(request);
  const userId = sessionUser ?? await resolveCaptureUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Shortcuts is loose about shape: the link may arrive as JSON {url} or
  // {text}, as a form field, as a raw text body, or in the query string, and
  // "Get URLs from Input" hands over a list. Take the first http(s) URL found
  // anywhere in that pile.
  const params = new URL(request.url).searchParams;
  const candidates: unknown[] = [params.get("url"), params.get("text")];
  const text =
    request.method === "POST" ? await request.text().catch(() => "") : "";
  let postJson: Record<string, unknown> | null = null;
  if (request.method === "POST") {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        postJson = parsed as Record<string, unknown>;
        candidates.push(
          postJson.url,
          postJson.text,
          postJson.link,
          postJson.input,
        );
      } else {
        candidates.push(parsed);
      }
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
      bodyPreview: text.slice(0, 200),
    });
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  const url = match[0];

  try {
    const html = typeof postJson?.html === "string" && postJson.html.length <= 4_000_000 ? postJson.html : null;
    const marker = request.headers.get("X-Capture-Source") ?? postJson?.source ?? params.get("source");
    const source = marker === "mac" || marker === "chrome" ? quickSource(marker) : sessionUser ? "web" : "quick";
    const input = { text: raw.slice(0, 100_000), url, files: [] };
    const meta = intakeMeta(request, userId, "reader", input, source, postJson?.requestId ?? params.get("requestId"), { input, html });
    const ownerId = userId;
    async function replay(tx: Pick<typeof prisma, "readerItem">, id: string) {
      const item = await tx.readerItem.findFirst({ where: { id, userId: ownerId } });
      if (!item) throw new CaptureReviewError(409, "The saved Reader item has been removed.");
      return { item, degraded: !item.contentHtml };
    }
    const previous = await findCaptureReplay(userId, meta.id, meta.requestHash!);
    if (previous) {
      const { item, degraded } = await replay(prisma, previous.placement.id);
      return NextResponse.json({ ok: true, id: item.id, title: item.title, minutes: Math.max(1, Math.round(item.wordCount / 230)), kindle: item.kindleSentAt ? "already-sent" : "off", ...(degraded ? { degraded: true } : {}), message: "Already saved", reviewId: meta.id });
    }
    // Extraction and any remote fetch finish before destination/review writes begin.
    let article: ExtractedArticle | null = null;
    let extractionError = "extraction failed";
    if (html) {
      try { article = await extractArticleFromHtml(url, html); }
      catch (error) { console.warn("[reader] html extraction failed; fetching url", { url, error: error instanceof Error ? error.message : String(error) }); }
    }
    if (!article) {
      try { article = await extractArticle(url); }
      catch (error) { extractionError = error instanceof Error ? error.message : extractionError; }
    }
    const extracted = article;
    const outcome = await withCaptureReview(meta, {
      commit: async tx => {
        const existing = await tx.readerItem.findFirst({ where: { userId, url } });
        const data = extracted ? { title: extracted.title, byline: extracted.byline, siteName: extracted.siteName, excerpt: extracted.excerpt, imageUrl: extracted.imageUrl, contentHtml: extracted.contentHtml, wordCount: extracted.wordCount, archivedAt: null } : null;
        const item = data
          ? existing ? await tx.readerItem.update({ where: { id: existing.id }, data }) : await tx.readerItem.create({ data: { userId, url, ...data } })
          : existing ?? await tx.readerItem.create({ data: { userId, url, title: url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 120), excerpt: `Saved without reader view (${extractionError})` } });
        return { value: { item, degraded: !extracted }, placement: { type: "reader", id: item.id, title: item.title ?? "Read Later item", destination: "Read Later", path: `/reader/${item.id}` } };
      }, replay: (tx, placement) => replay(tx, placement.id),
    });
    const { item, degraded } = outcome.value;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { kindleEmail: true, kindleAutoSend: true } });
    const shouldAutoSend = Boolean(outcome.created && !degraded && user?.kindleEmail && user.kindleAutoSend && !item.kindleSentAt && item.contentHtml);
    const kindleState = degraded ? "skipped" : shouldAutoSend ? "sending" : item.kindleSentAt ? "already-sent" : "off";
    if (shouldAutoSend) after(async () => {
      try {
        const result = await sendReaderItemToKindle(item.id);
        if (!result.ok) console.warn("[reader] auto-send not sent", { itemId: item.id, status: result.status, error: result.error });
      } catch (error) { console.error("[reader] auto-send failed", { itemId: item.id, error }); }
    });
    const minutes = Math.max(1, Math.round(item.wordCount / 230));
    const suffix = kindleState === "sending" ? " · sending to Kindle" : kindleState === "already-sent" ? " · already on Kindle" : "";
    return NextResponse.json({ ok: true, id: item.id, title: item.title, minutes, kindle: kindleState, ...(degraded ? { degraded: true } : {}), message: degraded ? "Saved link only (no article text)" : `Saved · ${minutes} min${suffix}`, reviewId: outcome.reviewId });
  } catch (error) {
    if (error instanceof CaptureReviewError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[reader] save failed", error);
    return NextResponse.json({ error: "Couldn't save this link. Please try again." }, { status: 500 });
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
