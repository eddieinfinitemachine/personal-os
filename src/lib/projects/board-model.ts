// /projects page model types and bucketing, shared by the server loader
// (board.ts) and the client board, which re-buckets after an optimistic pin
// or hide. Pure: no Prisma here.

import { COMPANY_ORDER, type Company } from "./company";
import type { RepoPlan } from "./github";

const DAY = 24 * 60 * 60 * 1000;
export const BOARD_ACTIVE_DAYS = 14;
export const DORMANT_DAYS = 90;

export type Visibility = "auto" | "pinned" | "hidden";
export const VISIBILITIES: readonly Visibility[] = ["auto", "pinned", "hidden"];

export type ActivityLine = {
  kind: "commit" | "meeting" | "todo" | "note";
  text: string;
  at: string;
  /** Commits: the branch, when it isn't the default one. */
  branch?: string | null;
  url?: string | null;
};

export type BoardCard = {
  /** "project:<id>" | "repo:<sourceId>" */
  id: string;
  kind: "project" | "repo";
  name: string;
  company: Company;
  visibility: Visibility;
  lastActivityAt: string | null;
  activity: ActivityLine[];
  plan: { text: string; section: string | null }[];
  planTotal: number;
  /** /projects/<id> for personal-os Projects. */
  href: string | null;
  githubUrl: string | null;
  homepageUrl: string | null;
  projectId: string | null;
  sourceId: string | null;
};

export type SuggestedTopic = {
  id: string;
  name: string;
  company: string;
  meetings: number;
  lastMeetingAt: string | null;
};

export type ProjectsBoard = {
  suggested: SuggestedTopic[];
  groups: { company: Company; cards: BoardCard[] }[];
  dormant: BoardCard[];
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

/** Splits cards into company groups, Dormant and Hidden. */
export function bucketCards(cards: BoardCard[], now: Date): Pick<ProjectsBoard, "groups" | "dormant" | "hidden"> {
  const activeCutoff = now.getTime() - BOARD_ACTIVE_DAYS * DAY;
  const dormantCutoff = now.getTime() - DORMANT_DAYS * DAY;
  const at = (c: BoardCard) => (c.lastActivityAt ? Date.parse(c.lastActivityAt) : 0);
  const byRecent = (a: BoardCard, b: BoardCard) => at(b) - at(a) || a.name.localeCompare(b.name);

  const active: BoardCard[] = [];
  const dormant: BoardCard[] = [];
  const hidden: BoardCard[] = [];
  for (const c of cards) {
    if (c.visibility === "hidden") hidden.push(c);
    else if (c.visibility === "pinned" || at(c) >= activeCutoff) active.push(c);
    else if (at(c) >= dormantCutoff) dormant.push(c);
  }
  const groups = COMPANY_ORDER.map((company) => ({
    company,
    cards: active
      .filter((c) => c.company === company)
      .sort((a, b) => Number(b.visibility === "pinned") - Number(a.visibility === "pinned") || byRecent(a, b)),
  })).filter((g) => g.cards.length);
  return { groups, dormant: dormant.sort(byRecent), hidden: hidden.sort(byRecent) };
}
