// Pure helpers for the /dating board and rows views: group people by stage,
// sort by most recent activity, and the date labels on each card. No React or
// Prisma so it stays unit-testable.
//
// Dates are formatted in UTC with a fixed locale. Event days are stored at
// noon UTC, and the card is server-rendered then hydrated, so a fixed zone
// keeps the server and browser markup identical.

import { STAGES, type Stage } from "@/lib/dating";

export type BoardView = "board" | "rows";

/** The fields these helpers read off a card. */
export type BoardPerson = {
  id: string;
  stage: string;
  metAt: string | null;
  endedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  /** Earliest event of any kind. */
  firstEventAt: string | null;
  /** Latest event of any kind. */
  lastEventAt: string | null;
};

const DAY = 86_400_000;
const t = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/** Newest of last text, last event, end and creation, as epoch ms. */
export function lastActivity(p: BoardPerson): number {
  const times = [t(p.lastMessageAt), t(p.lastEventAt), t(p.createdAt)];
  if (p.stage === "ended") times.push(t(p.endedAt));
  return Math.max(0, ...times.filter((n) => !Number.isNaN(n)));
}

/** Most recent activity first; ties by id so the order is stable. */
export function byActivity<T extends BoardPerson>(a: T, b: T): number {
  return lastActivity(b) - lastActivity(a) || a.id.localeCompare(b.id);
}

/**
 * People bucketed by stage (every stage present, in STAGES order), each
 * bucket sorted by most recent activity. Unknown stages fall into "talking".
 */
export function groupByStage<T extends BoardPerson>(people: T[]): Record<Stage, T[]> {
  const out = Object.fromEntries(STAGES.map((s) => [s, [] as T[]])) as Record<Stage, T[]>;
  for (const p of people) {
    const s = (STAGES as readonly string[]).includes(p.stage) ? (p.stage as Stage) : "talking";
    out[s].push(p);
  }
  for (const s of STAGES) out[s].sort(byActivity);
  return out;
}

/**
 * The optimistic copy of a stage change, mirroring PATCH /api/dating/[id]:
 * moving to "ended" stamps endedAt with now; leaving "ended" keeps it.
 */
export function withStage<T extends BoardPerson>(p: T, stage: Stage, now = new Date()): T {
  if (p.stage === stage) return p;
  return { ...p, stage, endedAt: stage === "ended" ? now.toISOString() : p.endedAt };
}

/** Board on wide screens (≥1024px), rows below. */
export function defaultView(width: number): BoardView {
  return width >= 1024 ? "board" : "rows";
}

export function parseView(v: unknown): BoardView | null {
  return v === "board" || v === "rows" ? v : null;
}

// ---------------------------------------------------------------------------
// Labels

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const year = (iso: string) => new Date(iso).getUTCFullYear();

/** "Sep 12", or "Sep 12, 2025" outside the current year. */
export function shortDate(iso: string, now = new Date()): string {
  return year(iso) === now.getUTCFullYear()
    ? fmt(iso, { month: "short", day: "numeric" })
    : fmt(iso, { month: "short", day: "numeric", year: "numeric" });
}

/** "4 days", "5 wks", "3 mos", "2 yrs". */
export function duration(ms: number): string {
  const days = Math.max(0, Math.round(ms / DAY));
  if (days < 14) return days === 1 ? "1 day" : `${days} days`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} wks`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} mos`;
  return `${Math.round(days / 365.25)} yrs`;
}

/** "Jun 2026", "Jun–Jul 2026", "Dec 2025–Feb 2026". */
export function monthRange(startIso: string, endIso: string): string {
  const [a, b] = [fmt(startIso, { month: "short" }), fmt(endIso, { month: "short" })];
  const [ya, yb] = [year(startIso), year(endIso)];
  if (ya !== yb) return `${a} ${ya}–${b} ${yb}`;
  return a === b ? `${a} ${ya}` : `${a}–${b} ${ya}`;
}

/** When it started: metAt, else the earliest event. */
export function startedAt(p: BoardPerson): string | null {
  return p.metAt ?? p.firstEventAt ?? null;
}

/**
 * The card's main subline: how long it lasted or has been going.
 *   ended  → "Jun–Jul 2026 · 5 wks" (or "Ended Mar 2025" with no start)
 *   others → "since Aug 2026 · 7 wks" (or "Added Sep 2026" with no start)
 */
export function spanLabel(p: BoardPerson, now = new Date()): string {
  const start = startedAt(p);
  if (p.stage === "ended") {
    const end = p.endedAt ?? p.lastEventAt ?? p.lastMessageAt;
    if (!start) return end ? `Ended ${fmt(end, { month: "short", year: "numeric" })}` : "Ended";
    if (!end || t(end) < t(start)) return `${fmt(start, { month: "short", year: "numeric" })} · ended`;
    return `${monthRange(start, end)} · ${duration(t(end) - t(start))}`;
  }
  if (!start) return `Added ${fmt(p.createdAt, { month: "short", year: "numeric" })}`;
  return `since ${fmt(start, { month: "short", year: "numeric" })} · ${duration(now.getTime() - t(start))}`;
}

/** Average-vibe tone for the small indicator on the card. */
export function vibeTone(v: number): "good" | "ok" | "low" {
  return v >= 7 ? "good" : v >= 5 ? "ok" : "low";
}

/** Concise, explicit relationship dates; imported activity is not a boundary. */
export function relationshipDates(p: Pick<BoardPerson, "stage" | "metAt" | "endedAt">): string | null {
  const start = Number.isFinite(t(p.metAt)) ? p.metAt : null;
  const end = Number.isFinite(t(p.endedAt)) ? p.endedAt : null;
  if (p.stage === "ended" && end) {
    if (start && t(start) <= t(end)) return monthRange(start, end);
    return `Ended ${fmt(end, { month: "short", year: "numeric" })}`;
  }
  return start ? `Met ${fmt(start, { month: "short", year: "numeric" })}` : null;
}

/** Search names without requiring accents, punctuation or original word order. */
export function matchesPersonName(name: string, query: string): boolean {
  if (!query.trim()) return true;
  const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const words = fold(query).split(" ").filter(Boolean);
  const normalized = fold(name);
  return words.length > 0 && words.every((word) => normalized.includes(word));
}

/** Past relationships follow their recorded dates; a fresh import isn't a fresh relationship. */
export function byPastRelationship<T extends BoardPerson>(a: T, b: T): number {
  const date = (p: BoardPerson) => [t(p.endedAt), t(p.metAt)].find(Number.isFinite) ?? 0;
  return date(b) - date(a) || byActivity(a, b);
}
