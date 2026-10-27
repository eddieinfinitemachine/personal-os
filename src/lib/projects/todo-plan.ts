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
  for (const line of markdown.split(/\r?\n/)) {
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
      const text = open[1].length > MAX_TEXT ? `${open[1].slice(0, MAX_TEXT - 1)}…` : open[1];
      items.push({ text, section });
    }
  }
  return { items, total };
}
