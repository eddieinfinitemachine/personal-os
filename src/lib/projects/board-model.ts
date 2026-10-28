// /projects page model types and bucketing, shared by the server loader
// (board.ts) and the client board, which re-buckets after an optimistic pin
// or hide. Pure: no Prisma here.

import type { Company } from "./company";
import type { RepoPlan } from "./github";

const DAY = 24 * 60 * 60 * 1000;
export const BOARD_ACTIVE_DAYS = 14;

export type Visibility = "auto" | "pinned" | "hidden";
export const VISIBILITIES: readonly Visibility[] = ["auto", "pinned", "hidden"];

export type ActivityLine = {
  kind: "commit";
  text: string;
  at: string;
  /** The branch, when it isn't the default one. */
  branch?: string | null;
  url?: string | null;
};

/** One GitHub repo with my recent commits. */
export type BoardCard = {
  /** "repo:<sourceId>" */
  id: string;
  name: string;
  company: Company;
  visibility: Visibility;
  lastActivityAt: string | null;
  activity: ActivityLine[];
  plan: { text: string; section: string | null }[];
  planTotal: number;
  githubUrl: string | null;
  homepageUrl: string | null;
  sourceId: string;
};

export type ProjectsBoard = {
  cards: BoardCard[];
  hidden: BoardCard[];
  /** Last GitHub sync (founder only). */
  syncedAt: string | null;
};

/** Normalises ProjectSource.plan (a RepoPlan, or the column default `[]`). */
export function readPlan(value: unknown): RepoPlan {
  if (Array.isArray(value)) return { items: value as RepoPlan["items"], total: value.length };
  const v = value as Partial<RepoPlan> | null;
  const items = Array.isArray(v?.items) ? v!.items : [];
  return { items, total: typeof v?.total === "number" ? v.total : items.length };
}

/**
 * Shown cards (pinned, or active in the last 14 days; pinned first, then
 * newest) and Hidden (newest first). Anything older and unpinned drops off.
 */
export function bucketCards(cards: BoardCard[], now: Date): Pick<ProjectsBoard, "cards" | "hidden"> {
  const activeCutoff = now.getTime() - BOARD_ACTIVE_DAYS * DAY;
  const at = (c: BoardCard) => (c.lastActivityAt ? Date.parse(c.lastActivityAt) : 0);
  const byRecent = (a: BoardCard, b: BoardCard) => at(b) - at(a) || a.name.localeCompare(b.name);
  const pinnedFirst = (a: BoardCard, b: BoardCard) =>
    Number(b.visibility === "pinned") - Number(a.visibility === "pinned") || byRecent(a, b);

  const shown: BoardCard[] = [];
  const hidden: BoardCard[] = [];
  for (const c of cards) {
    if (c.visibility === "hidden") hidden.push(c);
    else if (c.visibility === "pinned" || at(c) >= activeCutoff) shown.push(c);
  }
  return { cards: shown.sort(pinnedFirst), hidden: hidden.sort(byRecent) };
}
