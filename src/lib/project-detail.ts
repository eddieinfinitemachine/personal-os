// Project rows (generic, vehicle, pet, human) as the /projects/[id] page reads
// them, shared with GET /api/projects and GET /api/projects/[id] so the web and
// the native app can't drift.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureDefaultLists } from "@/lib/lists";
import { listAccessWhere } from "@/lib/list-access";

/** Kinds whose page opens on a Dashboard tab. */
export const DASHBOARD_KINDS = ["vehicle", "pet", "human"] as const;

export function hasDashboard(kind: string): boolean {
  return (DASHBOARD_KINDS as readonly string[]).includes(kind);
}

/** The columns every project read returns, plus the id of its vehicle, pet or human record. */
export const projectSummarySelect = {
  id: true,
  name: true,
  kind: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  vehicle: { select: { id: true } },
  pet: { select: { id: true } },
  human: { select: { id: true } },
} satisfies Prisma.ProjectSelect;

export type ProjectSummaryRow = Prisma.ProjectGetPayload<{ select: typeof projectSummarySelect }>;

export function toProjectSummary(p: ProjectSummaryRow) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    archived: p.archived,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    hasDashboard: hasDashboard(p.kind),
    vehicleId: p.vehicle?.id ?? null,
    petId: p.pet?.id ?? null,
    humanId: p.human?.id ?? null,
  };
}

/** The caller's own project, or null when it doesn't exist or is someone else's (the page 404s on both). */
export async function findOwnProject(userId: string, id: string): Promise<ProjectSummaryRow | null> {
  const project = await prisma.project.findUnique({ where: { id }, select: projectSummarySelect });
  return project && project.userId === userId ? project : null;
}

/** The Notes and Files tabs: the caller's own notes or attachments on the project. */
export function projectContentWhere(userId: string, projectId: string) {
  return { userId, projectId };
}

/**
 * The Tasks tab: the caller's default lists (To Do, Inbox, Monitor, Later),
 * each holding the project's open top-level todos the caller can access, not
 * snoozed into the future. Todos on custom or shared lists aren't shown.
 */
export async function getProjectTasks(userId: string, projectId: string, now = new Date()) {
  await ensureDefaultLists(userId);

  // The list and todo queries are independent: fire in parallel.
  const [lists, allTodos] = await Promise.all([
    prisma.list.findMany({
      where: { userId, isDefault: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.todo.findMany({
      where: {
        projectId,
        completedAt: null,
        parentId: null,
        // Snoozed todos stay hidden until their resurface time passes.
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
        // Allow shared-list collaborators to see/edit todos on this project's
        // tabs. Note: the project itself is still owned by `userId` (project
        // sharing is a future scope).
        list: listAccessWhere(userId),
      },
      orderBy: [
        // Undated todos stay in manual order on top; dated ones sink to the bottom.
        { dueDate: { sort: "asc", nulls: "first" } },
        { position: "asc" },
        { createdAt: "asc" },
      ],
      include: {
        subtasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
        _count: { select: { attachments: true } },
      },
    }),
  ]);
  const byList = new Map<string, typeof allTodos>();
  for (const t of allTodos) {
    (byList.get(t.listId) ?? byList.set(t.listId, []).get(t.listId))!.push(t);
  }
  return lists.map((list) => {
    const all = byList.get(list.id) ?? [];
    return {
      list,
      todos: all.map((t) => ({
        id: t.id,
        title: t.title,
        notes: t.notes,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        createdAt: t.createdAt,
        snoozedUntil: t.snoozedUntil,
        attachmentCount: t._count.attachments,
        projectId: t.projectId,
        subtasks: t.subtasks.map((s) => ({
          id: s.id,
          title: s.title,
          notes: s.notes,
          dueDate: s.dueDate,
          completedAt: s.completedAt,
          projectId: s.projectId,
        })),
      })),
      totalCount: all.length,
    };
  });
}
