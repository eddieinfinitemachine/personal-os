// The /projects page model: GitHub repos with my commits (founder only; the
// projects-github cron keeps ProjectSource rows current). Repos with commits
// in the last 14 days show, newest first; pinned ones always show, first;
// hidden ones collapse into Hidden. Other tenants get an empty board.

import { prisma } from "@/lib/prisma";
import { VISIBILITIES, bucketCards, readPlan, type BoardCard, type ProjectsBoard, type Visibility } from "./board-model";
import { isCompany } from "./company";
import type { RepoCommit } from "./github";

export * from "./board-model";

export const PLAN_SHOWN = 5;
export const ACTIVITY_SHOWN = 3;

export async function getProjectsBoard(userId: string, isFounder: boolean, now = new Date()): Promise<ProjectsBoard> {
  if (!isFounder) return { cards: [], hidden: [], syncedAt: null };

  const repos = await prisma.projectSource.findMany({ where: { userId, kind: "repo" } });
  const cards: BoardCard[] = repos.map((r) => {
    const commits = (Array.isArray(r.commits) ? r.commits : []) as unknown as RepoCommit[];
    const plan = readPlan(r.plan);
    return {
      id: `repo:${r.id}`,
      name: r.name,
      company: isCompany(r.company) ? r.company : "Personal",
      visibility: (VISIBILITIES as readonly string[]).includes(r.state) ? (r.state as Visibility) : "auto",
      lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
      activity: commits
        .map((c) => ({ kind: "commit" as const, text: c.message, at: c.at, branch: c.branch, url: c.url }))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, ACTIVITY_SHOWN),
      plan: plan.items.slice(0, PLAN_SHOWN),
      planTotal: plan.total,
      githubUrl: r.url,
      homepageUrl: r.homepageUrl,
      sourceId: r.id,
    };
  });
  const syncedAt = repos.reduce<Date | null>((m, r) => (r.syncedAt && (!m || r.syncedAt > m) ? r.syncedAt : m), null);

  return { ...bucketCards(cards, now), syncedAt: syncedAt?.toISOString() ?? null };
}
