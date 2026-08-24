import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";

// Undo for a delete. The client snapshots the row before removing it and
// posts it back here; we re-create it with its ORIGINAL id so subtasks
// (which the snapshot carries) reattach and any lingering client-side
// reference still points at the right row.
//
// Deliberately not POST /api/todos: that mints a new id, drops subtasks, and
// emails shared-list participants — an undo should be silent and faithful.
// Attachments and comments are gone with the original delete (cascade); the
// task itself comes back.

type Snapshot = {
  id?: string;
  title?: string;
  notes?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
  listId?: string;
  projectId?: string | null;
  position?: number;
  createdAt?: string | null;
  droppedAt?: string | null;
  isReference?: boolean;
  snoozedUntil?: string | null;
  parentId?: string | null;
  subtasks?: Snapshot[];
};

function date(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { todo } = (await request.json()) as { todo?: Snapshot };
  const title = todo?.title?.trim();
  if (!todo || !title || !todo.listId) {
    return NextResponse.json({ error: "todo snapshot required" }, { status: 400 });
  }

  // Same authorization as creating: the target list has to be one you can
  // write to. A restore never widens access.
  const list = await prisma.list.findFirst({
    where: { id: todo.listId, ...listAccessWhere(userId) },
  });
  if (!list) return NextResponse.json({ error: "list not found" }, { status: 404 });

  // A stale undo (the row was restored already, or never actually deleted)
  // is a no-op, not an error.
  if (todo.id) {
    const existing = await prisma.todo.findUnique({ where: { id: todo.id } });
    if (existing) return NextResponse.json({ todo: existing, restored: false });
  }

  let projectId = todo.projectId ?? null;
  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    // The project may have been deleted since; the task still deserves to
    // come back, just unfiled.
    if (!project || project.userId !== userId) projectId = null;
  }

  // Subtasks only restore under a parent that still exists — the snapshot's
  // parent may itself have been deleted in the meantime.
  let parentId = todo.parentId ?? null;
  if (parentId) {
    const parent = await prisma.todo.findFirst({
      where: { id: parentId, list: listAccessWhere(userId) },
    });
    if (!parent) parentId = null;
  }

  const restored = await prisma.todo.create({
    data: {
      ...(todo.id ? { id: todo.id } : {}),
      userId,
      title,
      notes: todo.notes ?? null,
      listId: todo.listId,
      projectId,
      parentId,
      position: todo.position ?? 0,
      dueDate: date(todo.dueDate),
      completedAt: date(todo.completedAt),
      droppedAt: date(todo.droppedAt),
      isReference: todo.isReference ?? false,
      snoozedUntil: date(todo.snoozedUntil),
      ...(date(todo.createdAt) ? { createdAt: date(todo.createdAt)! } : {}),
    },
  });

  const subs = (todo.subtasks ?? []).filter((s) => s.title?.trim());
  if (subs.length > 0) {
    await prisma.todo.createMany({
      data: subs.map((s) => ({
        ...(s.id ? { id: s.id } : {}),
        userId,
        title: s.title!.trim(),
        notes: s.notes ?? null,
        listId: restored.listId,
        projectId: restored.projectId,
        parentId: restored.id,
        position: s.position ?? 0,
        dueDate: date(s.dueDate),
        completedAt: date(s.completedAt),
      })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({ todo: restored, restored: true });
}
