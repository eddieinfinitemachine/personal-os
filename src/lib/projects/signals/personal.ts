// personal-os todos and notes as /projects evidence: anything created, edited
// or completed in the window. Left out: dropped and reference todos, autopilot
// reminders other than Granola action items (vehicles, pets, renewals), the
// Journal, and Projects that are a Human or a Pet (health records).

import { prisma } from "@/lib/prisma";
import type { Gate } from "./gate";
import type { SignalItem } from "./types";

const MAX_TODOS = 400;
const MAX_NOTES = 150;
const JOURNAL = "Journal";

type ProjectRef = { id: string; name: string; kind: string; human: { id: string } | null; pet: { id: string } | null } | null;

const projectSelect = {
  select: { id: true, name: true, kind: true, human: { select: { id: true } }, pet: { select: { id: true } } },
} as const;

/** A project whose todos and notes never count as evidence. */
export function isPrivateProject(p: ProjectRef): boolean {
  if (!p) return false;
  return p.name.trim() === JOURNAL || p.kind === "human" || p.kind === "pet" || !!p.human || !!p.pet;
}

/** "granola:<noteId>:<n>" → noteId. */
export function granolaNoteOf(autopilotKey: string | null): string | null {
  if (!autopilotKey?.startsWith("granola:")) return null;
  return autopilotKey.split(":")[1] || null;
}

export type PersonalResult = { items: SignalItem[]; todos: number; notes: number };

export async function collectPersonal(userId: string, opts: { since: Date; gate: Gate }): Promise<PersonalResult> {
  const { since, gate } = opts;
  const [todos, notes] = await Promise.all([
    prisma.todo.findMany({
      where: {
        userId,
        droppedAt: null,
        isReference: false,
        OR: [{ createdAt: { gte: since } }, { completedAt: { gte: since } }, { completedAt: null, updatedAt: { gte: since } }],
      },
      select: {
        id: true,
        title: true,
        notes: true,
        updatedAt: true,
        completedAt: true,
        autopilotKey: true,
        project: projectSelect,
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_TODOS,
    }),
    prisma.note.findMany({
      where: { userId, updatedAt: { gte: since } },
      select: { id: true, title: true, body: true, updatedAt: true, project: projectSelect },
      orderBy: { updatedAt: "desc" },
      take: MAX_NOTES,
    }),
  ]);

  const items: SignalItem[] = [];
  let todoCount = 0;
  for (const t of todos) {
    if (t.autopilotKey && !t.autopilotKey.startsWith("granola:")) continue;
    if (isPrivateProject(t.project)) continue;
    todoCount++;
    if (gate.excludes({ title: t.title, text: t.notes, fromNoteId: granolaNoteOf(t.autopilotKey) })) continue;
    items.push({
      ref: `todo:${t.id}`,
      kind: "todo",
      title: t.title.trim() || "(untitled)",
      at: (t.completedAt ?? t.updatedAt).toISOString(),
      url: t.project ? `/projects/${t.project.id}` : null,
      detail: t.notes?.trim() || null,
      project: t.project?.name ?? null,
      done: !!t.completedAt,
    });
  }

  let noteCount = 0;
  for (const n of notes) {
    if (isPrivateProject(n.project)) continue;
    noteCount++;
    const body = n.body.trim();
    const title = n.title?.trim() || body.split("\n")[0].slice(0, 80).trim() || "(untitled)";
    if (gate.excludes({ title, text: body })) continue;
    items.push({
      ref: `note:${n.id}`,
      kind: "note",
      title,
      at: n.updatedAt.toISOString(),
      url: `/projects/${n.project.id}?tab=notes`,
      detail: body || null,
      project: n.project.name,
    });
  }

  return { items, todos: todoCount, notes: noteCount };
}
