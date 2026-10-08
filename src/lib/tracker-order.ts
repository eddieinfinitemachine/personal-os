// Pure helpers for the ordered list of enabled sidebar trackers. The list is
// cached per browser in localStorage (templates.STORAGE_KEY) and synced to
// User.sidebarTrackers so the order follows Eddie across devices. Kept free of
// React/DOM so the ordering, migration and validation rules are unit-testable.

import { TEMPLATES, type TemplateSlug } from "./templates";

const KNOWN = new Set<string>(TEMPLATES.map((t) => t.slug));

export function isTemplateSlug(v: unknown): v is TemplateSlug {
  return typeof v === "string" && KNOWN.has(v);
}

// Lenient read for cached/stored values: keep known slugs in order, drop
// unknown or duplicate entries. Anything that is not an array reads as [].
export function parseTrackerSlugs(raw: unknown): TemplateSlug[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<TemplateSlug>();
  const out: TemplateSlug[] = [];
  for (const v of raw) {
    if (!isTemplateSlug(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= TEMPLATES.length) break;
  }
  return out;
}

// Strict validation for the PUT body: an array of known slugs only. Duplicates
// are dropped (first wins) rather than rejected; length is capped.
export function validateTrackerSlugs(
  raw: unknown,
): { ok: true; value: TemplateSlug[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "trackers must be an array." };
  for (const v of raw) {
    if (!isTemplateSlug(v)) return { ok: false, error: "Unknown tracker." };
  }
  return { ok: true, value: parseTrackerSlugs(raw) };
}

// Before ordering existed, the cache was a Set serialised in the order trackers
// were added, while the sidebar always showed TEMPLATES order. Legacy caches
// are normalised to that displayed order once, so nothing reshuffles.
export function sortByTemplateOrder(slugs: TemplateSlug[]): TemplateSlug[] {
  const rank = new Map(TEMPLATES.map((t, i) => [t.slug, i]));
  return [...slugs].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

export type InitialSync =
  | { kind: "adopt"; slugs: TemplateSlug[] }
  | { kind: "upload"; slugs: TemplateSlug[] }
  | { kind: "none" };

// What to do once the server's copy arrives. A null server value means no
// browser has synced yet, so this browser's cache becomes the source of truth
// (a one-time migration). Once the server has a value, it wins.
export function decideInitialSync(
  server: TemplateSlug[] | null,
  local: TemplateSlug[],
): InitialSync {
  if (server === null) {
    return local.length > 0 ? { kind: "upload", slugs: local } : { kind: "none" };
  }
  return sameOrder(server, local) ? { kind: "none" } : { kind: "adopt", slugs: server };
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Move `slug` to `toIndex` within `order` (clamped). Returns `order` unchanged
// (same reference) when the slug is absent or already there.
export function moveSlug<T extends string>(order: T[], slug: T, toIndex: number): T[] {
  const from = order.indexOf(slug);
  if (from < 0) return order;
  const to = Math.max(0, Math.min(order.length - 1, toIndex));
  if (from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, slug);
  return next;
}

// Apply a reorder made over a subset (the trackers a surface shows) back onto
// the full stored order: the subset's slots keep their positions and are
// refilled in the new sequence, so slugs the surface hides (private-only
// trackers on a shared session, Print lists in the footer) stay where they were.
export function applySubsetOrder(full: TemplateSlug[], subset: TemplateSlug[]): TemplateSlug[] {
  const inSubset = new Set(subset);
  const queue = subset.filter((s) => full.includes(s));
  if (queue.length !== inSubset.size) return full;
  let i = 0;
  return full.map((s) => (inSubset.has(s) ? queue[i++] : s));
}

// Visible templates in the stored order.
export function orderedTemplates<T extends { slug: TemplateSlug }>(
  order: TemplateSlug[],
  visible: T[],
): T[] {
  const bySlug = new Map(visible.map((t) => [t.slug, t]));
  return order.flatMap((s) => {
    const t = bySlug.get(s);
    return t ? [t] : [];
  });
}
