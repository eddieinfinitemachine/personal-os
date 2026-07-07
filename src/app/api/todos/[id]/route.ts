import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  // Auth via parent list membership — shared collaborators can edit too.
  // Note: toggleComplete still needs the current completedAt value, so we
  // do read the row, but the where clause scopes to accessible lists.
  const existing = await prisma.todo.findFirst({
    where: { id, list: listAccessWhere(userId) },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await request.json()) as {
    title?: string;
    notes?: string | null;
    listId?: string;
    projectId?: string | null;
    dueDate?: string | null;
    completedAt?: string | null;
    toggleComplete?: boolean;
    drop?: boolean;
    reference?: boolean;
    snoozedUntil?: string | null;
    discussed?: boolean;
  };

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.listId !== undefined) {
    // Target list must also be accessible to this user.
    const list = await prisma.list.findFirst({
      where: { id: body.listId, ...listAccessWhere(userId) },
    });
    if (!list) {
      return NextResponse.json({ error: "list not found" }, { status: 404 });
    }
    updates.listId = body.listId;
  }
  if (body.projectId !== undefined) {
    if (body.projectId) {
      const project = await prisma.project.findUnique({ where: { id: body.projectId } });
      if (!project || project.userId !== userId) {
        return NextResponse.json({ error: "project not found" }, { status: 404 });
      }
    }
    updates.projectId = body.projectId;
  }
  if (body.dueDate !== undefined) {
    updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  }
  if (body.completedAt !== undefined) {
    updates.completedAt = body.completedAt ? new Date(body.completedAt) : null;
  }
  if (body.toggleComplete) {
    updates.completedAt = existing.completedAt ? null : new Date();
  }
  // Decay actions. Dropped/Reference also set completedAt so every open-list
  // filter excludes them without changes; clearing restores the open state.
  if (body.drop === true) {
    updates.droppedAt = new Date();
    updates.completedAt = new Date();
  } else if (body.drop === false) {
    updates.droppedAt = null;
    updates.completedAt = null;
  }
  if (body.reference === true) {
    updates.isReference = true;
    updates.completedAt = new Date();
  } else if (body.reference === false) {
    updates.isReference = false;
    updates.completedAt = null;
  }
  if (body.snoozedUntil !== undefined) {
    updates.snoozedUntil = body.snoozedUntil
      ? new Date(body.snoozedUntil)
      : null;
  }
  // 1:1 agenda mode: stamp a discussion without completing the item.
  if (body.discussed === true) {
    updates.lastDiscussedAt = new Date();
    updates.discussCount = { increment: 1 };
  }

  const todo = await prisma.todo.update({ where: { id }, data: updates });
  return NextResponse.json({ todo });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await prisma.todo.deleteMany({
    where: { id, list: listAccessWhere(userId) },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
