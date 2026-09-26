import { prisma } from "@/lib/prisma";
import { callClaudeWithServerTools, type ClaudeResponseBlock } from "@/lib/claude";
import { resolveLink } from "@/lib/board";
import { BOARD_KINDS, type BoardKind } from "@/lib/board-embed";

// Recommendations from the mood board. Claude reads the board plus what you
// saved or waved off from earlier picks, writes a short taste profile, and
// uses web search to find real, current things (so every link resolves).
// Each link is then resolved like a board save to get an image and price.

export const MIN_ITEMS_FOR_RECS = 5;
const RECS_PER_RUN = 12;
const SEEDED_RECS = 8;
const BOARD_SAMPLE = 150;
// The Claude call gets a hard deadline inside the 300 s function limit; a run
// still "generating" past STALE_RUN_MS died with its function and is reported
// as failed (and can be reclaimed).
const CLAUDE_DEADLINE_MS = 220_000;
export const STALE_RUN_MS = 320_000;

// Errors whose message is safe and useful to show the user as-is.
export class RecsError extends Error {}

export type BoardSample = {
  kind: string;
  title: string | null;
  siteName: string | null;
  note: string | null;
  price: string | null;
  url: string | null;
};

export type Feedback = {
  saved: string[];
  dismissed: string[];
  shown: string[];
};

export type RawRec = {
  kind: BoardKind;
  title: string;
  creator: string | null;
  reason: string;
  url: string | null;
};

const SYSTEM = `You are a sharp, well-read friend with great taste who recommends things to one person based on their mood board: a collection of videos, songs, products, images, links, and notes they saved because they liked them.

Work in two steps.
1. Read the board and form a precise picture of their taste: recurring aesthetics, eras, materials, moods, genres, price points, creators. Be specific ("warm 70s Italian design, walnut and chrome", not "they like design").
2. Use web search to find real things that exist right now and fit that taste. Prefer specific, lesser-known finds over the obvious; a few can be adjacent stretches that still fit. Never recommend anything already on the board or already shown to them. Lean toward what they saved from past picks and away from what they dismissed.

Every recommendation needs a real URL you saw in search results: the product page, the YouTube or Vimeo video, the Spotify or Apple Music page, the article. Do not invent or guess URLs; if you can't find a good link for an idea, drop it.

When you're done, reply with only this JSON object and nothing else:
{"taste": "<2-4 sentences, second person, what their board says about their taste>", "recs": [{"kind": "video" | "music" | "product" | "image" | "link", "title": "<name of the thing>", "creator": "<artist, brand, director, author, or null>", "reason": "<one sentence on why it fits, naming something specific on their board>", "url": "<https URL from search>"}]}`;

function line(i: BoardSample): string {
  const parts = [`[${i.kind}]`, i.title ?? i.url ?? "(untitled)"];
  if (i.siteName) parts.push(`(${i.siteName})`);
  if (i.price) parts.push(i.price);
  if (i.note) parts.push(`note: "${i.note.replace(/\s+/g, " ").slice(0, 160)}"`);
  return `- ${parts.join(" ")}`;
}

export function buildRecsPrompt(
  items: BoardSample[],
  fb: Feedback,
  count = RECS_PER_RUN,
  seed?: BoardSample,
): string {
  const kinds = new Map<string, number>();
  for (const i of items) kinds.set(i.kind, (kinds.get(i.kind) ?? 0) + 1);
  const mix = [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
  const sections = [
    `Their board (${items.length} items, newest first; mix: ${mix}):`,
    items.map(line).join("\n"),
  ];
  if (fb.saved.length) sections.push(`Past picks they saved (more like these):\n${fb.saved.map((t) => `- ${t}`).join("\n")}`);
  if (fb.dismissed.length) sections.push(`Past picks they dismissed (less like these):\n${fb.dismissed.map((t) => `- ${t}`).join("\n")}`);
  if (fb.shown.length) sections.push(`Already shown to them, don't repeat:\n${fb.shown.map((t) => `- ${t}`).join("\n")}`);
  if (seed) {
    sections.push(
      `They asked for more like this one item:\n${line(seed)}\n\nFind ${count} recommendations close to what makes it appealing, read through the lens of the rest of the board. Mostly the same kind of thing; one or two can cross over (a song for a video, an object for an image). Each reason should connect back to this item.`,
    );
  } else {
    sections.push(
      `Find ${count} recommendations. Roughly follow the board's mix of kinds, but include at least one or two kinds they save less of. Notes are what they said about an item, so weight them heavily.`,
    );
  }
  return sections.join("\n\n");
}

function s(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function httpUrl(v: unknown): string | null {
  const raw = s(v, 2000);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// Collect the final answer's text (citations split it across blocks), then
// take the outermost JSON object.
export function parseRecsReply(content: ClaudeResponseBlock[]): { taste: string | null; recs: RawRec[] } {
  // Only the answer after the last search counts; earlier text is narration.
  let from = 0;
  content.forEach((b, i) => {
    if (b.type === "web_search_tool_result") from = i + 1;
  });
  const text = content
    .slice(from)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  const starts = [...text.matchAll(/\{\s*"taste"/g)];
  const start = starts.length ? starts[starts.length - 1].index! : text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON in reply");
  const data = JSON.parse(text.slice(start, end + 1)) as { taste?: unknown; recs?: unknown };
  const recs: RawRec[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(data.recs) ? data.recs : []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const title = s(o.title, 200);
    const reason = s(o.reason, 400);
    if (!title || !reason) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = (BOARD_KINDS as string[]).includes(o.kind as string) && o.kind !== "note" ? (o.kind as BoardKind) : "link";
    recs.push({ kind, title, creator: s(o.creator, 120), reason, url: httpUrl(o.url) });
  }
  return { taste: s(data.taste, 1200), recs };
}

// When a rec has no usable link, point at a search that will find it.
export function searchUrl(kind: BoardKind, title: string, creator: string | null): string {
  const q = encodeURIComponent([title, creator].filter(Boolean).join(" "));
  if (kind === "video") return `https://www.youtube.com/results?search_query=${q}`;
  if (kind === "music") return `https://open.spotify.com/search/${q}`;
  if (kind === "product") return `https://www.google.com/search?tbm=shop&q=${q}`;
  if (kind === "image") return `https://www.google.com/search?tbm=isch&q=${q}`;
  return `https://www.google.com/search?q=${q}`;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    t = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([p.catch(() => null), timeout]);
  } finally {
    clearTimeout(t);
  }
}

/** Claim a run. Returns false if one is already in flight for this user. */
export async function startRecsRun(userId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_RUN_MS);
  await prisma.boardTaste.upsert({ where: { userId }, create: { userId }, update: {} });
  const claimed = await prisma.boardTaste.updateMany({
    where: {
      userId,
      OR: [{ status: { not: "generating" } }, { startedAt: null }, { startedAt: { lt: staleBefore } }],
    },
    data: { status: "generating", error: null, startedAt: new Date() },
  });
  return claimed.count === 1;
}

/**
 * Generate a batch. Call after startRecsRun claimed the run. With `seedItemId`
 * ("More like this") the batch centers on one board item and is added on top
 * of the current picks instead of replacing them.
 */
export async function generateRecs(userId: string, opts: { seedItemId?: string } = {}): Promise<number> {
  try {
    const [items, saved, dismissed, shown, seed] = await Promise.all([
      prisma.boardItem.findMany({
        where: { userId },
        orderBy: { savedAt: "desc" },
        take: BOARD_SAMPLE,
        select: { kind: true, title: true, siteName: true, note: true, price: true, url: true },
      }),
      prisma.boardRec.findMany({ where: { userId, status: "saved" }, orderBy: { createdAt: "desc" }, take: 40 }),
      prisma.boardRec.findMany({ where: { userId, status: "dismissed" }, orderBy: { createdAt: "desc" }, take: 60 }),
      prisma.boardRec.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 150, select: { title: true } }),
      opts.seedItemId
        ? prisma.boardItem.findFirst({
            where: { id: opts.seedItemId, userId },
            select: { kind: true, title: true, siteName: true, note: true, price: true, url: true },
          })
        : null,
    ]);
    if (opts.seedItemId && !seed) throw new RecsError("That item is no longer on your board.");
    if (items.length < MIN_ITEMS_FOR_RECS) {
      throw new RecsError(`Save at least ${MIN_ITEMS_FOR_RECS} things to your board first.`);
    }
    const label = (r: { title: string; creator: string | null }) => (r.creator ? `${r.title} by ${r.creator}` : r.title);
    const { content, stopReason } = await callClaudeWithServerTools({
      system: SYSTEM,
      user: buildRecsPrompt(items, {
        saved: saved.map(label),
        dismissed: dismissed.map(label),
        shown: shown.map((r) => r.title),
      }, seed ? SEEDED_RECS : RECS_PER_RUN, seed ?? undefined),
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }],
      maxTokens: 16000,
      effort: "medium",
      timeoutMs: CLAUDE_DEADLINE_MS,
    });
    if (stopReason === "refusal") throw new RecsError("Claude declined this batch. Try again.");
    if (stopReason === "max_tokens" || stopReason === "pause_turn") {
      throw new RecsError("That batch ran long and got cut off. Try again.");
    }
    const { taste, recs } = parseRecsReply(content);
    if (!recs.length) throw new RecsError("No recommendations came back. Try again.");

    const boardUrls = new Set(items.map((i) => i.url).filter(Boolean));
    const fresh = recs.filter((r) => !r.url || !boardUrls.has(r.url));

    // Resolve each link like a board save (image, site, price), in parallel,
    // without letting one slow site hold up the batch.
    const enriched = await Promise.all(
      fresh.map(async (r) => {
        const resolved = r.url ? await withTimeout(resolveLink(r.url), 15_000) : null;
        const link = resolved?.ok ? resolved : null;
        // A link that 404s or never answers is likely made up or gone: point
        // at a search for the thing instead. Sites that merely block bots
        // (403, 429) keep their real link, just without an image.
        const dead = !resolved || (!resolved.ok && (resolved.status === undefined || resolved.status === 404 || resolved.status === 410));
        return {
          userId,
          kind: link && link.kind !== "link" && r.kind === "link" ? link.kind : r.kind,
          title: r.title,
          creator: r.creator,
          reason: r.reason,
          url: link?.url ?? (r.url && !dead ? r.url : searchUrl(r.kind, r.title, r.creator)),
          imageUrl: link?.imageSrc ?? null,
          siteName: link?.siteName ?? null,
          price: link?.price ?? null,
        };
      }),
    );

    await prisma.$transaction([
      // A full run replaces unanswered picks; "More like this" adds to them.
      ...(seed ? [] : [prisma.boardRec.deleteMany({ where: { userId, status: "new" } })]),
      prisma.boardRec.createMany({ data: enriched }),
      prisma.boardTaste.update({
        where: { userId },
        // A seeded run's profile is skewed toward one item, so keep the old one.
        data: { status: "idle", error: null, generatedAt: new Date(), ...(taste && !seed ? { profile: taste } : {}) },
      }),
    ]);
    return enriched.length;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[board-recs] generation failed", { userId, message });
    await prisma.boardTaste.update({
      where: { userId },
      data: {
        status: "error",
        error:
          e instanceof RecsError
            ? message
            : e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
              ? "That took too long. Try again."
              : "Couldn't get picks right now. Try again.",
      },
    });
    return 0;
  }
}
