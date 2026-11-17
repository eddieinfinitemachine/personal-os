// Keyset pagination for the Read Later list (`GET /api/reader`): newest saved
// first, ties broken by id, so a page boundary never skips or repeats an item
// even when items are saved, archived or deleted between requests.
//
// The cursor is opaque to clients: base64url of `[savedAt ISO, id]` of the last
// item on the previous page.

export const READER_PAGE_DEFAULT = 200;
export const READER_PAGE_MAX = 200;

export type ReaderCursor = { savedAt: Date; id: string };
export type ReaderPage = { limit: number; cursor: ReaderCursor | null };

export function encodeReaderCursor(item: { savedAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([item.savedAt.toISOString(), item.id])).toString("base64url");
}

export function decodeReaderCursor(raw: string): ReaderCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [iso, id] = parsed as unknown[];
    if (typeof iso !== "string" || typeof id !== "string" || !id) return null;
    const savedAt = new Date(iso);
    return Number.isNaN(savedAt.getTime()) ? null : { savedAt, id };
  } catch {
    return null;
  }
}

/** `limit` (1–200, default 200) and `cursor` from the query, or an error message for a 400. */
export function parseReaderPage(params: URLSearchParams): ReaderPage | { error: string } {
  const rawLimit = params.get("limit");
  let limit = READER_PAGE_DEFAULT;
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) return { error: "limit must be a whole number" };
    limit = Number(rawLimit);
    if (limit < 1 || limit > READER_PAGE_MAX) return { error: `limit must be between 1 and ${READER_PAGE_MAX}` };
  }
  const rawCursor = params.get("cursor");
  if (rawCursor === null || rawCursor === "") return { limit, cursor: null };
  const cursor = decodeReaderCursor(rawCursor);
  return cursor ? { limit, cursor } : { error: "invalid cursor" };
}

/** The Prisma `where` clause for items after `cursor` in (savedAt desc, id desc) order. */
export function afterCursor(cursor: ReaderCursor | null) {
  if (!cursor) return {};
  return {
    OR: [{ savedAt: { lt: cursor.savedAt } }, { savedAt: cursor.savedAt, id: { lt: cursor.id } }],
  };
}
