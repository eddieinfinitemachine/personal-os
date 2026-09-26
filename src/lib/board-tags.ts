import { prisma } from "@/lib/prisma";
import { callClaudeText, type ClaudeContentBlock } from "@/lib/claude";

// Claude sorts every board item into one or two free-form categories
// ("Musicians", "Architecture", "Restaurants") that the board's filter chips
// are built from. Tagging runs after the save has already returned, so it
// must never throw and never block anything.

const TAG_MODEL = "claude-haiku-4-5-20251001";
export const MAX_TAGS = 2;
export const MAX_TAG_LENGTH = 30;

export type TaggableItem = {
  kind: string;
  title: string | null;
  note: string | null;
  url: string | null;
  siteName: string | null;
  imageUrl: string | null;
};

const SYSTEM = `You file items from someone's mood board into categories so they can filter the board.

Give each item 1 or 2 tags. A tag is a short plural category noun in Title Case, like "Musicians", "Architecture", "Interiors", "Restaurants", "Fashion", "Photography", "Books", "Films", "Furniture", "Art", "Travel". Name what the item is about, not its format: a photo of a chair is "Furniture", a YouTube video of a band is "Musicians" or "Music".

A bare name is a reference to who or what that is. "Leonard Cohen" and "Nico Jaar" are musicians, so tag them "Musicians". Use what you know.

Strongly prefer reusing one of their existing tags when it fits, even loosely, so their set of tags stays small and consistent. Only invent a new tag when none of the existing ones fits.

Reply with only this JSON and nothing else: {"tags": ["<Tag>"]}`;

function describe(item: TaggableItem): string {
  const lines = [`Kind: ${item.kind}`];
  if (item.title) lines.push(`Title: ${item.title.slice(0, 300)}`);
  if (item.note) lines.push(`Note: ${item.note.replace(/\s+/g, " ").slice(0, 800)}`);
  if (item.siteName) lines.push(`Site: ${item.siteName}`);
  if (item.url) lines.push(`URL: ${item.url.slice(0, 500)}`);
  return lines.join("\n");
}

export function buildTagPrompt(item: TaggableItem, existingTags: string[]): string {
  const existing = existingTags.length
    ? `Their existing tags: ${existingTags.slice(0, 60).join(", ")}`
    : "They have no tags yet.";
  return `${existing}\n\nThe item:\n${describe(item)}`;
}

// Anthropic can only fetch public https images; local /uploads paths can't be sent.
function imageBlock(item: TaggableItem): ClaudeContentBlock | null {
  if (!item.imageUrl) return null;
  try {
    const u = new URL(item.imageUrl);
    return u.protocol === "https:" ? { type: "image", source: { type: "url", url: u.toString() } } : null;
  } catch {
    return null;
  }
}

/**
 * Pull tags out of the model's reply and clean them up: trim, collapse
 * whitespace, cap length, dedupe case-insensitively, keep at most MAX_TAGS.
 * A tag that matches an existing one (ignoring case) takes the existing
 * spelling. Anything unparseable yields [].
 */
export function parseTags(raw: string, existingTags: string[] = []): string[] {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let data: unknown;
  try {
    data = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const list = (data as { tags?: unknown })?.tags;
  if (!Array.isArray(list)) return [];
  const known = new Map(existingTags.map((t) => [t.toLowerCase(), t]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    if (typeof v !== "string") continue;
    const cleaned = v
      .replace(/^[\s#"'“”]+|[\s"'“”.]+$/g, "")
      .replace(/\s+/g, " ")
      .slice(0, MAX_TAG_LENGTH)
      .trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(known.get(key) ?? cleaned);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

async function ask(item: TaggableItem, existingTags: string[], withImage: boolean): Promise<string> {
  const text = buildTagPrompt(item, existingTags);
  const image = withImage ? imageBlock(item) : null;
  return callClaudeText({
    model: TAG_MODEL,
    system: SYSTEM,
    maxTokens: 100,
    messages: [{ role: "user", content: image ? [image, { type: "text", text }] : text }],
  });
}

/** 1–2 category tags for an item, or [] on any failure. Never throws. */
export async function tagBoardItem(item: TaggableItem, existingTags: string[]): Promise<string[]> {
  try {
    let raw: string;
    try {
      raw = await ask(item, existingTags, true);
    } catch (e) {
      // Anthropic couldn't fetch the image (dead link, blocked host, bad
      // format): it answers 400. Try again on the words alone.
      if (!imageBlock(item) || !(e instanceof Error) || !e.message.startsWith("Claude error 400")) throw e;
      raw = await ask(item, existingTags, false);
    }
    return parseTags(raw, existingTags);
  } catch (e) {
    console.error("[board-tags] tagging failed", { error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/** Distinct tags on a user's items, most used first. */
export async function userTags(userId: string): Promise<string[]> {
  const rows = await prisma.boardItem.findMany({
    where: { userId, NOT: { tags: { isEmpty: true } } },
    select: { tags: true },
  });
  return rankTags(rows.map((r) => r.tags));
}

export function rankTags(lists: string[][]): string[] {
  const counts = new Map<string, number>();
  for (const tags of lists) for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

const TAGGABLE = { id: true, kind: true, title: true, note: true, url: true, siteName: true, imageUrl: true } as const;

/** Tag one freshly saved item. For `after()`; swallows every error. */
export async function tagInBackground(userId: string, itemId: string): Promise<void> {
  try {
    const item = await prisma.boardItem.findFirst({ where: { id: itemId, userId }, select: TAGGABLE });
    if (!item) return;
    const tags = await tagBoardItem(item, await userTags(userId));
    if (tags.length) await prisma.boardItem.updateMany({ where: { id: itemId, userId }, data: { tags } });
  } catch (e) {
    console.error("[board-tags] background tagging failed", { itemId, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Tag up to `limit` of a user's untagged items, oldest first, one at a time so
 * each item can reuse the tags the previous ones introduced. Items the model
 * couldn't tag stay untagged (and are counted in `remaining`); their ids come
 * back in `failed` so a caller looping over batches can `skip` them.
 */
export async function backfillTags(
  userId: string,
  { limit = 40, deadline, skip = [] }: { limit?: number; deadline?: number; skip?: string[] } = {},
): Promise<{ tagged: number; remaining: number; failed: string[] }> {
  const items = await prisma.boardItem.findMany({
    where: { userId, tags: { isEmpty: true }, ...(skip.length ? { id: { notIn: skip } } : {}) },
    orderBy: { savedAt: "asc" },
    take: limit,
    select: TAGGABLE,
  });
  const existing = await userTags(userId);
  let tagged = 0;
  const failed: string[] = [];
  for (const item of items) {
    if (deadline && Date.now() > deadline) break;
    const tags = await tagBoardItem(item, existing);
    if (!tags.length) {
      failed.push(item.id);
      continue;
    }
    await prisma.boardItem.updateMany({ where: { id: item.id, userId }, data: { tags } });
    tagged++;
    for (const t of tags) if (!existing.includes(t)) existing.push(t);
  }
  const remaining = await prisma.boardItem.count({ where: { userId, tags: { isEmpty: true } } });
  return { tagged, remaining, failed };
}
