// Pure URL helpers for the mood board, safe to import on client and server.

export type BoardKind = "image" | "video" | "music" | "product" | "link" | "note";

export const BOARD_KINDS: BoardKind[] = ["image", "video", "music", "product", "link", "note"];

function hostOf(url: URL): string {
  return url.hostname.replace(/^(www\.|m\.)/, "").toLowerCase();
}

export function youtubeId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = hostOf(url);
  if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
  if (host === "youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const m = url.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
    if (m) return m[2];
  }
  return null;
}

// Kind from the URL alone; page metadata can still upgrade "link" to
// "product" or "image" (see classifyFromMeta in lib/board.ts).
export function kindFromUrl(raw: string): BoardKind {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "link";
  }
  const host = hostOf(url);
  const path = url.pathname.toLowerCase();
  if (/\.(jpe?g|png|gif|webp|avif|heic)$/.test(path)) return "image";
  if (host === "music.youtube.com") return "music";
  if (
    youtubeId(raw) ||
    host === "vimeo.com" ||
    host.endsWith("tiktok.com") ||
    host === "loom.com" ||
    (host === "instagram.com" && /^\/(reel|reels|tv)\//.test(path)) ||
    ((host === "x.com" || host === "twitter.com") && path.includes("/video/"))
  ) {
    return "video";
  }
  if (
    host === "open.spotify.com" ||
    host === "music.apple.com" ||
    host === "soundcloud.com" ||
    host.endsWith("bandcamp.com") ||
    host === "tidal.com" ||
    host === "listen.tidal.com"
  ) {
    return "music";
  }
  if (
    /(^|\.)amazon\.[a-z.]+$/.test(host) ||
    host === "etsy.com" ||
    host === "ebay.com" ||
    host === "grailed.com" ||
    host === "ssense.com" ||
    host === "mrporter.com" ||
    host === "shop.app"
  ) {
    return "product";
  }
  if (
    (host.endsWith("pinterest.com") && path.startsWith("/pin/")) ||
    (host === "instagram.com" && path.startsWith("/p/")) ||
    host === "cosmos.so" ||
    host === "are.na" ||
    host === "dribbble.com" ||
    host === "unsplash.com"
  ) {
    return "image";
  }
  return "link";
}

// Player URL for the lightbox, when the source has an embeddable player.
export function embedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const yt = youtubeId(raw);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = hostOf(url);
  if (host === "vimeo.com") {
    const id = url.pathname.match(/^\/(\d+)/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}?autoplay=1` : null;
  }
  if (host === "open.spotify.com") {
    const m = url.pathname.match(
      /^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/,
    );
    return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
  }
  if (host === "music.apple.com") {
    return `https://embed.music.apple.com${url.pathname}${url.search}`;
  }
  return null;
}

export function displayHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
