// /projects page model types and bucketing, shared by the server loader
// (board.ts) and the client board, which re-buckets after an optimistic pin
// or hide. Pure: no Prisma here.

import type { Company } from "./company";
import { EVIDENCE_KINDS, type EvidenceKind, type StoredEvidence } from "./signals/types";

export type Visibility = "auto" | "pinned" | "hidden" | "finished";
export const VISIBILITIES: readonly Visibility[] = ["auto", "pinned", "hidden", "finished"];

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
  /** The latest run didn't return it, so it has gone quiet: it shows its saved data. */
  stale: boolean;
  sourceId: string;
};

export type ProjectsBoard = {
  cards: BoardCard[];
  hidden: BoardCard[];
  /** Closed out by Eddie. A run never reopens one. */
  finished: BoardCard[];
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
 * Shown cards (pinned first, then active before quiet, then newest), then Hidden
 * and Finished (newest first). The store ages quiet cards out, so nothing does here.
 */
export function bucketCards(cards: BoardCard[]): Pick<ProjectsBoard, "cards" | "hidden" | "finished"> {
  const at = (c: BoardCard) => (c.lastActivityAt ? Date.parse(c.lastActivityAt) : 0);
  const byRecent = (a: BoardCard, b: BoardCard) => at(b) - at(a) || a.name.localeCompare(b.name);
  const pinnedFirst = (a: BoardCard, b: BoardCard) =>
    Number(b.visibility === "pinned") - Number(a.visibility === "pinned") ||
    Number(a.stale) - Number(b.stale) ||
    byRecent(a, b);

  const shown: BoardCard[] = [];
  const hidden: BoardCard[] = [];
  const finished: BoardCard[] = [];
  for (const c of cards) (c.visibility === "hidden" ? hidden : c.visibility === "finished" ? finished : shown).push(c);
  return { cards: shown.sort(pinnedFirst), hidden: hidden.sort(byRecent), finished: finished.sort(byRecent) };
}
