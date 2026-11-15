// Read-only view of the mood board for tools that hold the capture token
// (GET /api/capture/board): the pictures and their tags, nothing else. A tool
// uses it to offer board images as references, e.g. a moodboard for a product.

export const BOARD_READ_MAX = 300;

export type BoardReadQuery = { tag?: string; kind?: string; q?: string; limit: number };

const KINDS = new Set(["image", "video", "music", "product", "link", "note"]);

export function parseBoardRead(params: URLSearchParams): BoardReadQuery {
  const text = (key: string) => params.get(key)?.trim().slice(0, 80) || undefined;
  const kind = text("kind");
  const limit = Number(params.get("limit"));
  return {
    tag: text("tag"),
    kind: kind && KINDS.has(kind) ? kind : undefined,
    q: text("q"),
    limit: Number.isFinite(limit) && limit >= 1 ? Math.min(BOARD_READ_MAX, Math.floor(limit)) : 120,
  };
}

export type BoardReference = {
  id: string;
  kind: string;
  title: string | null;
  note: string | null;
  siteName: string | null;
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  tags: string[];
  savedAt: string;
};

type Row = Omit<BoardReference, "imageUrl" | "savedAt" | "tags"> & { imageUrl: string | null; tags?: string[] | null; savedAt: Date | string };

/** Only what a reference picker needs. The source page, price and capture route stay behind the session. */
export function toBoardReference(row: Row): BoardReference | null {
  if (!row.imageUrl) return null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    note: row.note,
    siteName: row.siteName,
    imageUrl: row.imageUrl,
    imageWidth: row.imageWidth,
    imageHeight: row.imageHeight,
    tags: row.tags ?? [],
    savedAt: typeof row.savedAt === "string" ? row.savedAt : row.savedAt.toISOString(),
  };
}

/** Tags with how many pictures carry each, most used first. */
export function tagCounts(rows: { tags?: string[] | null }[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) for (const tag of row.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
