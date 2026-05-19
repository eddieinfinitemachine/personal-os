import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.todo.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
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
  };

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.listId !== undefined) {
    const list = await prisma.list.findUnique({ where: { id: body.listId } });
    if (!list || list.userId !== userId) {
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
  const existing = await prisma.todo.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.todo.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
