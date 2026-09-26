import { del, put } from "@vercel/blob";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import heicConvert from "heic-convert";
import { deleteFile, saveFile } from "@/lib/storage";
import { safeFetch } from "@/lib/safe-fetch";
import { kindFromUrl, youtubeId, type BoardKind } from "@/lib/board-embed";
import { sniffImage } from "@/lib/board-sniff";

// Server side of the mood board: turn a shared URL into a card (title, image,
// kind, price) and re-host its image so the board survives expiring CDN links.

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 1600;

export type PageMeta = {
  title: string | null;
  siteName: string | null;
  description: string | null;
  imageSrc: string | null;
  ogType: string | null;
  price: string | null;
  isProduct: boolean;
};

export type ResolvedLink = {
  kind: BoardKind;
  url: string;
  title: string | null;
  siteName: string | null;
  description: string | null;
  price: string | null;
  imageSrc: string | null;
  /** Set when the URL itself served an image, so it isn't fetched twice. */
  imageBody?: Buffer;
  /** False when neither oEmbed nor the page answered 2xx (dead or blocked link). */
  ok: boolean;
  /** HTTP status of the page fetch; undefined if it never got an answer. */
  status?: number;
};

export type StoredImage = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  color: string | null;
};

function meta(doc: Document, ...keys: string[]): string | null {
  for (const key of keys) {
    const el = doc.querySelector(`meta[property="${key}"], meta[name="${key}"], meta[itemprop="${key}"]`);
    const v = el?.getAttribute("content")?.trim();
    if (v) return v;
  }
  return null;
}

function formatPrice(amount: string | number | null | undefined, currency: string | null): string | null {
  if (amount == null || amount === "") return null;
  const n = Number(String(amount).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
    } catch {
      // Unknown ISO code; fall through.
    }
  }
  return `$${n.toFixed(2)}`;
}

// JSON-LD Product blocks carry name/image/price on most shops that skip og tags.
function findLdProduct(doc: Document): Record<string, unknown> | null {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    while (queue.length) {
      const node = queue.shift();
      if (Array.isArray(node)) queue.push(...node);
      else if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        const type = obj["@type"];
        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return obj;
        if (obj["@graph"]) queue.push(obj["@graph"]);
      }
    }
  }
  return null;
}

function firstString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return firstString(v[0]);
  if (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string") {
    return (v as { url: string }).url;
  }
  return null;
}

export function parsePageMeta(html: string, pageUrl: string): PageMeta {
  const doc = new JSDOM(html, { url: pageUrl }).window.document;
  const product = findLdProduct(doc);
  const offers = product
    ? ((Array.isArray(product.offers) ? product.offers[0] : product.offers) as Record<string, unknown> | undefined)
    : undefined;
  const ogType = meta(doc, "og:type");

  const priceAmount =
    meta(doc, "product:price:amount", "og:price:amount", "price") ??
    (offers ? String(offers.price ?? offers.lowPrice ?? "") : null);
  const currency =
    meta(doc, "product:price:currency", "og:price:currency", "priceCurrency") ??
    (offers && typeof offers.priceCurrency === "string" ? offers.priceCurrency : null);

  const rawImage =
    meta(doc, "og:image:secure_url", "og:image", "twitter:image", "twitter:image:src") ??
    (product ? firstString(product.image) : null) ??
    doc.querySelector('link[rel="image_src"]')?.getAttribute("href") ??
    null;
  let imageSrc: string | null = null;
  if (rawImage) {
    try {
      imageSrc = new URL(rawImage, pageUrl).toString();
    } catch {
      imageSrc = null;
    }
  }

  return {
    title:
      meta(doc, "og:title", "twitter:title") ??
      (product && typeof product.name === "string" ? product.name : null) ??
      (doc.title.trim() || null),
    siteName: meta(doc, "og:site_name", "application-name"),
    description: meta(doc, "og:description", "twitter:description", "description"),
    imageSrc,
    ogType,
    price: formatPrice(priceAmount, currency),
    isProduct: Boolean(product) || ogType === "product" || ogType === "og:product" || ogType === "product.item",
  };
}

type OEmbed = {
  title?: string;
  author_name?: string;
  provider_name?: string;
  thumbnail_url?: string;
};

function oembedEndpoint(url: string): string | null {
  const host = new URL(url).hostname.replace(/^(www\.|m\.)/, "");
  const q = encodeURIComponent(url);
  if (youtubeId(url)) return `https://www.youtube.com/oembed?format=json&url=${q}`;
  if (host === "vimeo.com") return `https://vimeo.com/api/oembed.json?url=${q}`;
  if (host === "open.spotify.com") return `https://open.spotify.com/oembed?url=${q}`;
  if (host === "soundcloud.com") return `https://soundcloud.com/oembed?format=json&url=${q}`;
  if (host.endsWith("tiktok.com")) return `https://www.tiktok.com/oembed?url=${q}`;
  return null;
}

async function fetchOEmbed(url: string): Promise<OEmbed | null> {
  const endpoint = oembedEndpoint(url);
  if (!endpoint) return null;
  try {
    const res = await safeFetch(endpoint, { accept: "application/json", timeoutMs: 8_000, maxBytes: 512 * 1024 });
    if (res.status < 200 || res.status >= 300) return null;
    return JSON.parse(res.body.toString("utf8")) as OEmbed;
  } catch {
    return null;
  }
}

export async function resolveLink(url: string): Promise<ResolvedLink> {
  let kind = kindFromUrl(url);
  const out: ResolvedLink = {
    kind,
    url,
    title: null,
    siteName: null,
    description: null,
    price: null,
    imageSrc: null,
    ok: false,
  };

  const oembed = await fetchOEmbed(url);
  if (oembed) {
    out.ok = true;
    out.title = oembed.title ?? null;
    out.siteName = oembed.provider_name ?? null;
    out.description = oembed.author_name ?? null;
    out.imageSrc = oembed.thumbnail_url ?? null;
    const yt = youtubeId(url);
    // oEmbed hands back the letterboxed 4:3 hqdefault; maxres is true 16:9.
    if (yt) out.imageSrc = `https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`;
    if (out.title && out.imageSrc) return out;
  }

  try {
    const res = await safeFetch(url, {
      accept: "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5",
      timeoutMs: 12_000,
      maxBytes: MAX_IMAGE_BYTES,
    });
    out.status = res.status;
    if (res.status >= 200 && res.status < 300) {
      out.ok = true;
      if (res.contentType?.startsWith("image/")) {
        out.kind = "image";
        out.imageBody = res.body;
        out.url = res.url;
        return out;
      }
      const m = parsePageMeta(res.body.toString("utf8").slice(0, 3_000_000), res.url);
      out.title ??= m.title;
      out.siteName ??= m.siteName;
      out.description ??= m.description;
      out.imageSrc ??= m.imageSrc;
      out.price = m.price;
      if (kind === "link") {
        if (m.isProduct || m.price) kind = "product";
        else if (m.ogType?.startsWith("video")) kind = "video";
        else if (m.ogType?.startsWith("music")) kind = "music";
      }
      out.kind = kind;
    }
  } catch (e) {
    console.warn("[board] page fetch failed", { url, error: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

export async function fetchImage(src: string): Promise<Buffer | null> {
  const tries = [src];
  // Not every YouTube video has a maxres thumbnail; hq always exists.
  if (src.includes("/maxresdefault.jpg")) tries.push(src.replace("/maxresdefault.jpg", "/hqdefault.jpg"));
  for (const u of tries) {
    try {
      const res = await safeFetch(u, { accept: "image/*", timeoutMs: 12_000, maxBytes: MAX_IMAGE_BYTES });
      if (res.status >= 200 && res.status < 300 && res.body.length > 0) return res.body;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

// Normalize (EXIF-rotate, cap at 1600px, WebP, keep GIF animation) and upload.
// iPhone HEIC goes through heic-convert first (the bundled libvips has no
// HEVC decoder). Returns null when the bytes aren't a decodable image.
export async function storeBoardImage(userId: string, raw: Buffer): Promise<StoredImage | null> {
  let input = raw;
  if (sniffImage(raw) === "heic") {
    try {
      input = Buffer.from(await heicConvert({ buffer: raw, format: "JPEG", quality: 0.9 }));
    } catch (e) {
      console.warn("[board] heic decode failed", { error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }
  let out: Buffer;
  let width: number;
  let height: number;
  let color: string | null = null;
  try {
    const src = sharp(input, { animated: true, limitInputPixels: 100_000_000 });
    out = await src
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const m = await sharp(out).metadata();
    width = m.width ?? 0;
    height = m.pageHeight ?? m.height ?? 0;
    if (!width || !height) return null;
    const { dominant } = await sharp(out).stats();
    color = `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
  } catch (e) {
    console.warn("[board] image decode failed", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }

  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.webp`;
  let imageUrl: string;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`users/${userId}/board/${name}`, out, {
      access: "public",
      addRandomSuffix: false,
      contentType: "image/webp",
    });
    imageUrl = blob.url;
  } else {
    imageUrl = await saveFile(`board/${userId}`, name, out);
  }
  return { imageUrl, imageWidth: width, imageHeight: height, color };
}

export async function deleteBoardImage(imageUrl: string | null): Promise<void> {
  if (!imageUrl) return;
  try {
    if (imageUrl.startsWith("/uploads/")) await deleteFile(imageUrl);
    else if (/\.blob\.vercel-storage\.com\//.test(imageUrl)) await del(imageUrl);
  } catch (e) {
    console.error("[board] blob delete failed (orphaned)", imageUrl, e);
  }
}
