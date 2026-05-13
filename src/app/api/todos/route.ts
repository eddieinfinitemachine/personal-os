import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const listId = url.searchParams.get("listId");
  const projectId = url.searchParams.get("projectId");
  const includeCompleted = url.searchParams.get("includeCompleted") === "1";

  const where: Record<string, unknown> = {};
  if (listId) where.listId = listId;
  if (projectId === "none") where.projectId = null;
  else if (projectId) where.projectId = projectId;
  if (!includeCompleted) where.completedAt = null;

  const todos = await prisma.todo.findMany({
    where,
    orderBy: [
      { completedAt: "asc" },
      { dueDate: "asc" },
      { position: "asc" },
      { createdAt: "asc" },
    ],
  });
  return NextResponse.json({ todos });
}

export async function POST(request: Request) {
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

  // Subtasks inherit list/project from their parent.
  if (body.parentId) {
    const parent = await prisma.todo.findUnique({
      where: { id: body.parentId },
    });
    if (!parent) return NextResponse.json({ error: "parent not found" }, { status: 404 });
    const todo = await prisma.todo.create({
      data: {
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
  const list = await prisma.list.findUnique({ where: { id: body.listId } });
  if (!list) return NextResponse.json({ error: "list not found" }, { status: 404 });

  const todo = await prisma.todo.create({
    data: {
      title,
      listId: body.listId,
      notes: body.notes ?? null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      projectId: body.projectId ?? null,
    },
  });
  return NextResponse.json({ todo });
}
