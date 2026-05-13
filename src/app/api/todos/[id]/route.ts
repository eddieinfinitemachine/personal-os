import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
  if (body.listId !== undefined) updates.listId = body.listId;
  if (body.projectId !== undefined) updates.projectId = body.projectId;
  if (body.dueDate !== undefined) {
    updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  }
  if (body.completedAt !== undefined) {
    updates.completedAt = body.completedAt ? new Date(body.completedAt) : null;
  }
  if (body.toggleComplete) {
    const existing = await prisma.todo.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    updates.completedAt = existing.completedAt ? null : new Date();
  }

  const todo = await prisma.todo.update({ where: { id }, data: updates });
  return NextResponse.json({ todo });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.todo.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
