import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";

// Enrich a media entry from a pasted link: YouTube/Vimeo via oEmbed,
// everything else via OpenGraph tags. Returns only what it could read —
// the editor fills empty fields and never overwrites typed ones.

// Prefix/suffix matching (unanchored alternatives) — a fully-anchored
// alternation would only match the literal prefix as the whole hostname.
const BLOCKED_HOST =
  /^(localhost$|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)|\.(local|internal)$/i;

function guessCategory(hostname: string): string | null {
  const h = hostname.toLowerCase();
  if (/podcasts\.apple|spotify\.com/.test(h)) return "podcast";
  if (/goodreads\.com|books\.google/.test(h)) return "book";
  if (/imdb\.com|netflix\.com|letterboxd/.test(h)) return "film";
  if (/substack\.com|medium\.com|nytimes|wsj\.com|theatlantic|newyorker/.test(h))
    return "article";
  if (/ted\.com/.test(h)) return "TED talks";
  return null;
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  const raw = typeof body.url === "string" ? body.url.trim() : "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (BLOCKED_HOST.test(url.hostname)) {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  try {
    // YouTube / Vimeo: oEmbed gives clean title + author + thumbnail.
    if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/i.test(url.hostname)) {
      const oembed =
        url.hostname.includes("vimeo")
          ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(raw)}`
          : `https://www.youtube.com/oembed?url=${encodeURIComponent(raw)}&format=json`;
      const res = await fetch(oembed, {
        headers: { "User-Agent": "personal-os/1.0 (media enrichment)" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          title?: string;
          author_name?: string;
          thumbnail_url?: string;
        };
        return NextResponse.json({
          title: data.title ?? null,
          subtitle: data.author_name ?? null,
          imageUrl: data.thumbnail_url ?? null,
          category: guessCategory(url.hostname),
        });
      }
    }

    // Everything else: read OpenGraph / <title> from the page head.
    const res = await fetch(raw, {
      headers: {
        "User-Agent": "Mozilla/5.0 (personal-os media enrichment)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const html = (await res.text()).slice(0, 500_000);

    const meta = (name: string): string | null => {
      const re = new RegExp(
        `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`,
        "i"
      );
      const m = html.match(re);
      const v = m?.[1] ?? m?.[2];
      return v ? decodeEntities(v.trim()) : null;
    };
    const title =
      meta("og:title") ??
      meta("twitter:title") ??
      (decodeEntities(
        html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? ""
      ) || null);
    const subtitle = meta("og:site_name") ?? meta("author");
    const imageUrl = meta("og:image") ?? meta("twitter:image");

    if (!title && !imageUrl) {
      return NextResponse.json(
        { error: "Couldn't read that link." },
        { status: 422 }
      );
    }
    return NextResponse.json({
      title,
      subtitle,
      imageUrl,
      category: guessCategory(url.hostname),
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't read that link." },
      { status: 422 }
    );
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
