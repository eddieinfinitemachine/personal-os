// Fuzzy name matching for "Add to…" on a Granola suggestion: which of the
// people already on /dating a transcribed name most likely is ("Margo" →
// "Margot Langman", "Margaux Forciene"). Pure, so it's unit-tested.

/** Lowercase, accents folded, anything but letters/digits turned into spaces. */
export function foldName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// 0..1 for one word against another. A prefix either way ("margo"/"margot",
// "kat"/"katherine") scores high; otherwise the better of edit-distance
// similarity and a shared-prefix score, so "margo" is closer to "margaux"
// than to "maria".
function wordScore(a: string, b: string): number {
  if (a === b) return 1;
  const short = Math.min(a.length, b.length);
  if (short >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.9;
  let common = 0;
  while (common < short && a[common] === b[common]) common++;
  const prefix = common >= 3 ? (common / short) * 0.85 : 0;
  const edit = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  return Math.max(prefix, edit);
}

/**
 * How well `query` matches `name`, 0..1. Each query word takes its best
 * match among the name's words, averaged; a word-for-word identical name is 1.
 */
export function nameScore(query: string, name: string): number {
  const q = foldName(query);
  const n = foldName(name);
  if (!q || !n) return 0;
  if (q === n) return 1;
  const qs = q.split(" ");
  const ns = n.split(" ");
  const total = qs.reduce((sum, w) => sum + Math.max(...ns.map((x) => wordScore(w, x))), 0);
  // Just under an exact match, so "Ana" still ranks "Ana" above "Ana Lopez".
  return Math.min(total / qs.length, 0.99);
}

/** Below this a name isn't treated as a likely match. */
export const LIKELY_MATCH = 0.6;

/** `people` best match first (ties alphabetical). Doesn't filter. */
export function rankByName<T extends { name: string }>(query: string, people: T[]): (T & { score: number })[] {
  return people
    .map((p) => ({ ...p, score: nameScore(query, p.name) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
