import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";

// Safari-Reader-style extraction. Articles go through Mozilla Readability
// (the engine behind Firefox reader view); tweets go through Twitter's
// public oEmbed. Output HTML is sanitized before it ever reaches the DB.

export type ExtractedArticle = {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  contentHtml: string;
  wordCount: number;
};

const BLOCKED_HOST =
  /^(localhost$|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)|\.(local|internal)$/i;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

function sanitize(html: string): string {
  const window = new JSDOM("").window;
  const purify = createDOMPurify(window);
  return purify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "button", "iframe"],
    FORBID_ATTR: ["style", "onerror", "onclick"],
    ADD_ATTR: ["target"],
  });
}

function assertFetchable(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http(s) links can be saved.");
  }
  if (BLOCKED_HOST.test(url.hostname)) {
    throw new Error("That host can't be fetched.");
  }
  return url;
}

async function extractTweet(raw: string): Promise<ExtractedArticle> {
  // publish.twitter.com wants the twitter.com URL form.
  const normalized = raw.replace(/^https?:\/\/(www\.)?x\.com\//i, "https://twitter.com/");
  const res = await fetch(
    `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalized)}&omit_script=true&dnt=true`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) throw new Error("Couldn't load that tweet.");
  const data = (await res.json()) as {
    html?: string;
    author_name?: string;
    author_url?: string;
  };
  const html = sanitize(data.html ?? "");
  const text = html.replace(/<[^>]+>/g, " ");
  return {
    url: raw,
    title: `${data.author_name ?? "Tweet"}: ${text.trim().slice(0, 80)}…`,
    byline: data.author_name ?? null,
    siteName: "X",
    excerpt: text.trim().slice(0, 240) || null,
    imageUrl: null,
    contentHtml: html,
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}

export async function extractArticle(raw: string): Promise<ExtractedArticle> {
  const url = assertFetchable(raw.trim());

  if (/(^|\.)(twitter\.com|x\.com)$/i.test(url.hostname)) {
    return extractTweet(raw.trim());
  }

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Page returned ${res.status}.`);
  const html = (await res.text()).slice(0, 3_000_000);

  const dom = new JSDOM(html, { url: url.toString() });
  const doc = dom.window.document;

  const ogImage =
    doc
      .querySelector('meta[property="og:image"], meta[name="twitter:image"]')
      ?.getAttribute("content") ?? null;
  const siteName =
    doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ??
    url.hostname.replace(/^www\./, "");

  const article = new Readability(doc, { charThreshold: 250 }).parse();
  if (!article || !article.content) {
    throw new Error("Couldn't extract a readable article from that page.");
  }

  const contentHtml = sanitize(article.content);
  const text = article.textContent ?? "";
  return {
    url: url.toString(),
    title: article.title || doc.title || url.hostname,
    byline: article.byline?.trim() || null,
    siteName: article.siteName || siteName,
    excerpt: article.excerpt?.trim().slice(0, 300) || null,
    imageUrl: ogImage,
    contentHtml,
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}
