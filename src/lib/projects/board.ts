// The /projects page model: the projects Claude inferred from Eddie's
// meetings, email, todos and notes (founder only; the projects-infer cron
// keeps them current). Pinned first, then newest; hidden ones ("Not a
// project") collapse into Hidden. Other tenants get an empty board.

import { bucketCards, type BoardCard, type ProjectsBoard } from "./board-model";
import { loadInferred } from "./inferred-store";
import type { StoredEvidence } from "./signals/types";

export * from "./board-model";

/** Upcoming first (soonest first), then newest first. */
export function orderEvidence(evidence: StoredEvidence[], now: Date): StoredEvidence[] {
  const t = (e: StoredEvidence) => Date.parse(e.at);
  const upcoming = (e: StoredEvidence) => t(e) > now.getTime();
  return [...evidence].sort((a, b) =>
    Number(upcoming(b)) - Number(upcoming(a)) || (upcoming(a) ? t(a) - t(b) : t(b) - t(a)),
  );
}

export async function getProjectsBoard(userId: string, isFounder: boolean, now = new Date()): Promise<ProjectsBoard> {
  if (!isFounder) return { cards: [], hidden: [], syncedAt: null, refreshFailed: false };

  const { projects, run } = await loadInferred(userId);
  const returned = new Set(run?.keys ?? []);
  const cards: BoardCard[] = projects.map((p) => ({
    id: `inferred:${p.id}`,
    name: p.name,
    company: p.company,
    visibility: p.state,
    lastActivityAt: p.lastActivityAt,
    status: p.status,
    next: p.next,
    evidence: orderEvidence(p.evidence, now),
    stale: p.state === "pinned" && !!run?.lastSuccessAt && !returned.has(p.key),
    sourceId: p.id,
  }));

  return { ...bucketCards(cards), syncedAt: run?.lastCheckedAt ?? null, refreshFailed: !!run?.error };
}
