import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const listId = url.searchParams.get("listId");
  const projectId = url.searchParams.get("projectId");
  const includeCompleted = url.searchParams.get("includeCompleted") === "1";

  // Auth via parent list membership, not direct ownership.
  const where: Record<string, unknown> = { list: listAccessWhere(userId) };
  if (listId) where.listId = listId;
  if (projectId === "none") where.projectId = null;
  else if (projectId) where.projectId = projectId;
  if (!includeCompleted) where.completedAt = null;

  const rows = await prisma.todo.findMany({
    where: { ...where, parentId: null },
    orderBy: [
      { completedAt: "asc" },
      { dueDate: "asc" },
      { position: "asc" },
      { createdAt: "asc" },
    ],
    include: {
      project: { select: { name: true } },
      subtasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
    },
  });
  const todos = rows.map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    projectId: t.projectId,
    projectName: t.project?.name ?? null,
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      notes: s.notes,
      dueDate: s.dueDate,
      completedAt: s.completedAt,
    })),
  }));
  return NextResponse.json({ todos });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    title?: string;
    listId?: string;
    projectId?: string | null;
    notes?: string;
    dueDate?: string | null;
    parentId?: string | null;
  };
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  // Subtasks inherit list/project from their parent. Auth via parent's list
  // membership so Shane (member, not owner) can add subtasks to Eddie's
  // shared list. The Todo's userId stores the creator, not the list owner.
  if (body.parentId) {
    const parent = await prisma.todo.findFirst({
      where: { id: body.parentId, list: listAccessWhere(userId) },
    });
    if (!parent) {
      return NextResponse.json({ error: "parent not found" }, { status: 404 });
    }
    const todo = await prisma.todo.create({
      data: {
        userId,
        title,
        listId: parent.listId,
        projectId: parent.projectId,
        parentId: parent.id,
        notes: body.notes ?? null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
      },
    });
    return NextResponse.json({ todo });
  }

  if (!body.listId) return NextResponse.json({ error: "listId required" }, { status: 400 });
  const list = await prisma.list.findFirst({
    where: { id: body.listId, ...listAccessWhere(userId) },
  });
  if (!list) {
    return NextResponse.json({ error: "list not found" }, { status: 404 });
  }

  // If projectId is provided, ensure it belongs to the user. (Project
  // sharing is out of scope; only owned projects can be assigned.)
  if (body.projectId) {
    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project || project.userId !== userId) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }
  }

  const todo = await prisma.todo.create({
    data: {
      userId,
      title,
      listId: body.listId,
      notes: body.notes ?? null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      projectId: body.projectId ?? null,
    },
  });
  return NextResponse.json({ todo });
}
