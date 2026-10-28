// /projects page model types and bucketing, shared by the server loader
// (board.ts) and the client board, which re-buckets after an optimistic pin
// or hide. Pure: no Prisma here.

import type { Company } from "./company";
import { EVIDENCE_KINDS, type EvidenceKind, type StoredEvidence } from "./signals/types";

export type Visibility = "auto" | "pinned" | "hidden";
export const VISIBILITIES: readonly Visibility[] = ["auto", "pinned", "hidden"];

/** One project Claude inferred. */
export type BoardCard = {
  /** "inferred:<sourceId>" */
  id: string;
  name: string;
  company: Company;
  visibility: Visibility;
  lastActivityAt: string | null;
  status: string | null;
  next: string | null;
  /** Upcoming first (soonest first), then newest first. */
  evidence: StoredEvidence[];
  /** Pinned, but the latest run found nothing for it: it shows its saved data. */
  stale: boolean;
  sourceId: string;
};

export type ProjectsBoard = {
  cards: BoardCard[];
  hidden: BoardCard[];
  /** Last run that ended well (founder only). */
  syncedAt: string | null;
  /** The latest run failed; the board shows the result from `syncedAt`. */
  refreshFailed: boolean;
};

export function evidenceCounts(evidence: StoredEvidence[]): Record<EvidenceKind, number> {
  const counts = Object.fromEntries(EVIDENCE_KINDS.map((k) => [k, 0])) as Record<EvidenceKind, number>;
  for (const e of evidence) counts[e.kind]++;
  return counts;
}

/**
 * Shown cards (pinned first, then newest) and Hidden (newest first). Every
 * row is from the latest run or pinned, so nothing ages out here.
 */
export function bucketCards(cards: BoardCard[]): Pick<ProjectsBoard, "cards" | "hidden"> {
  const at = (c: BoardCard) => (c.lastActivityAt ? Date.parse(c.lastActivityAt) : 0);
  const byRecent = (a: BoardCard, b: BoardCard) => at(b) - at(a) || a.name.localeCompare(b.name);
  const pinnedFirst = (a: BoardCard, b: BoardCard) =>
    Number(b.visibility === "pinned") - Number(a.visibility === "pinned") || byRecent(a, b);

  const shown: BoardCard[] = [];
  const hidden: BoardCard[] = [];
  for (const c of cards) (c.visibility === "hidden" ? hidden : shown).push(c);
  return { cards: shown.sort(pinnedFirst), hidden: hidden.sort(byRecent) };
}
