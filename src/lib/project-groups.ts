import { INBOX_PROJECT_NAME } from "@/lib/lists";

// Sidebar/drawer project grouping: Inbox is pinned first (it's the capture
// spout, not a peer project), projects with open todos keep their manual
// order, and the zero-todo tail collapses behind an "N more" toggle.
// `keepIds` forces otherwise-dormant projects above the fold — used for the
// currently-open project so a freshly created (still empty) project doesn't
// vanish into the collapsed tail the moment you navigate to it.
export function partitionProjects<T extends { id: string; name: string }>(
  projects: T[],
  getCount: (p: T) => number,
  keepIds?: Set<string>
): { inbox: T | null; active: T[]; dormant: T[] } {
  let inbox: T | null = null;
  const active: T[] = [];
  const dormant: T[] = [];
  for (const p of projects) {
    if (!inbox && p.name === INBOX_PROJECT_NAME) {
      inbox = p;
      continue;
    }
    if (getCount(p) > 0 || keepIds?.has(p.id)) active.push(p);
    else dormant.push(p);
  }
  return { inbox, active, dormant };
}
