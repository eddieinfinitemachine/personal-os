// Pure mapping from a Cosmos (cosmos.so) export to board items. The export is
// what Cosmos's own GraphQL API returns for every element in every one of the
// user's collections (see scripts/import-cosmos.ts for how it's produced).
import { displayHost, kindFromUrl, type BoardKind } from "@/lib/board-embed";

export type CosmosMedia = {
  __typename: "StaticImage" | "Video" | "AnimatedImage" | string;
  url: string;
  width?: number | null;
  height?: number | null;
  thumbnail?: { url: string } | null;
};

export type CosmosElement = {
  id: number;
  type: "MediaElementTile" | "WebsiteElementTile" | "BaseElementTile" | "TextElementTile" | string;
  createdAt: string;
  shareUrl: string;
  caption: string | null;
  source: { url: string | null } | null;
  media: CosmosMedia | null;
  websiteTitle: string | null;
  websiteDescription: string | null;
};

export type CosmosCluster = { id: number; name: string; isPublicElementsCluster?: boolean };

export type CosmosExport = {
  clusters: CosmosCluster[];
  elements: CosmosElement[];
  /** cluster id -> element ids (null when that collection failed to load) */
  membership: Record<string, number[] | null>;
};

/** A board row to create directly, with the image re-hosted from `imageSrc`. */
export type CosmosItemPlan = {
  kind: BoardKind;
  url: string;
  title: string | null;
  siteName: string | null;
  imageSrc: string;
  imageWidth: number | null;
  imageHeight: number | null;
  savedAt: Date;
};

/** A saved link Cosmos never rendered: resolve it like a normal share instead. */
export type CosmosLinkPlan = { url: string; savedAt: Date };

// Cosmos names the collection that holds elements not yet filed anywhere.
const UNFILED = "Unsorted Elements";

// Captions are Cosmos's own AI descriptions with <n>…</n> around proper nouns.
export function cleanCaption(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/<\/?n>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 300) : null;
}

// Cosmos stores whatever was typed, e.g. "youtube.com/watch?v=x" without a scheme.
export function normalizeUrl(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Collection names an element belongs to, in export order, minus the unfiled bucket. */
export function tagsForElement(exp: CosmosExport, elementId: number): string[] {
  const names = new Map(exp.clusters.map((c) => [String(c.id), c.name.trim()]));
  const out: string[] = [];
  for (const [clusterId, ids] of Object.entries(exp.membership)) {
    if (!ids?.includes(elementId)) continue;
    const name = names.get(clusterId);
    if (!name || name === UNFILED || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

function imageSrcOf(media: CosmosMedia | null): string | null {
  if (!media) return null;
  if (media.__typename === "Video") return media.thumbnail?.url ?? null;
  return media.url || null;
}

/**
 * Decide how an element lands on the board. Elements with a picture become
 * image-backed rows (the tile is the picture, the link goes back to where it
 * was found, or to Cosmos when it was an upload). Elements Cosmos never
 * rendered but that have a source URL are re-resolved as plain links. Anything
 * else is dropped.
 */
export function planElement(el: CosmosElement): CosmosItemPlan | CosmosLinkPlan | null {
  const sourceUrl = normalizeUrl(el.source?.url);
  const savedAt = new Date(el.createdAt);
  const imageSrc = imageSrcOf(el.media);
  if (!imageSrc) {
    return sourceUrl ? { url: sourceUrl, savedAt } : null;
  }
  const url = sourceUrl ?? el.shareUrl;
  const fromUrl = kindFromUrl(url);
  const isWebsite = el.type === "WebsiteElementTile";
  // A saved picture is an image even when it came from a plain web page; a saved
  // page keeps whatever its URL says it is. Playable sources stay playable.
  const kind: BoardKind = isWebsite || fromUrl === "video" || fromUrl === "music" ? fromUrl : "image";
  const title = isWebsite ? el.websiteTitle?.trim().slice(0, 300) || null : cleanCaption(el.caption);
  return {
    kind,
    url,
    title,
    siteName: displayHost(url),
    imageSrc,
    imageWidth: el.media?.width ?? null,
    imageHeight: el.media?.height ?? null,
    savedAt,
  };
}

export function isItemPlan(plan: CosmosItemPlan | CosmosLinkPlan): plan is CosmosItemPlan {
  return "imageSrc" in plan;
}
