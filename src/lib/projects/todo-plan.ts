// A repo's "current plan": the open checklist items in its tasks/todo.md,
// each tagged with the nearest heading above it (# to ###).

export type PlanItem = { text: string; section: string | null };

export const PLAN_CAP = 8;
const MAX_TEXT = 200;

export function parseTodoPlan(markdown: string, cap = PLAN_CAP): { items: PlanItem[]; total: number } {
  const items: PlanItem[] = [];
  let total = 0;
  let section: string | null = null;
  let inFence = false;
  // The last open item, while its wrapped continuation lines may follow.
  let wrapping: PlanItem | null = null;
  const clip = (t: string) => (t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t);
  for (const line of markdown.split(/\r?\n/)) {
    const continued = /^\s+(?![-*+]\s|\d+[.)]\s)(\S.*)$/.exec(line);
    if (wrapping && !inFence && continued) {
      wrapping.text = clip(`${wrapping.text} ${continued[1].trim()}`);
      continue;
    }
    wrapping = null;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      section = heading[2].trim();
      continue;
    }
    const open = /^\s*[-*+]\s+\[ \]\s+(.+?)\s*$/.exec(line);
    if (!open) continue;
    total++;
    if (items.length < cap) {
      wrapping = { text: clip(open[1]), section };
      items.push(wrapping);
    }
  }
  return { items, total };
}
