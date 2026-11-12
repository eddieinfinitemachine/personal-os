import { NextResponse, after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { readJsonObject } from "@/lib/request-json";
import { syncRecentTodos } from "@/lib/gcal";
import { listAccessWhere } from "@/lib/list-access";
import { notifySharedListAdd } from "@/lib/notify";
import { commentStatsByTodo, creatorName, todoMeta } from "@/lib/home-meta";
import { nextTodoPosition } from "@/lib/todo-position";

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const listId = url.searchParams.get("listId");
  const projectId = url.searchParams.get("projectId");
  const includeCompleted = url.searchParams.get("includeCompleted") === "1";
  // stale=1: the sweep queue — open todos older than 14d across all lists,
  // oldest first. Snoozed-into-the-future items are excluded (deliberate).
  const stale = url.searchParams.get("stale") === "1";

  // Auth via parent list membership, not direct ownership.
  const where: Record<string, unknown> = { list: listAccessWhere(userId) };
  if (listId) where.listId = listId;
  if (projectId === "none") where.projectId = null;
  else if (projectId) where.projectId = projectId;
  if (!includeCompleted) {
    where.completedAt = null;
    // Snoozed todos stay hidden until their resurface time passes.
    where.OR = [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }];
  }
  if (stale) {
    where.completedAt = null;
    where.createdAt = { lt: new Date(Date.now() - 14 * 864e5) };
  }

  const todoWhere: Prisma.TodoWhereInput = { ...where, parentId: null };
  const creator = { select: { name: true, email: true } } as const;
  // Comment counts and unread badges as on the web Home: one comment query and
  // one read-marker query for the same set of todos, bucketed in memory.
  const [rows, comments, commentReads] = await Promise.all([
    prisma.todo.findMany({
      where: todoWhere,
      orderBy: stale
        ? [{ createdAt: "asc" }]
        : [
            { completedAt: "asc" },
            // Undated todos stay in manual order on top; dated ones sink to the bottom.
            { dueDate: { sort: "asc", nulls: "first" } },
            { position: "asc" },
            { createdAt: "asc" },
          ],
      include: {
        project: { select: { name: true } },
        _count: { select: { attachments: true } },
        // Creator, surfaced as "added by …" on collaborative lists.
        user: creator,
        subtasks: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          include: { user: creator },
        },
      },
    }),
    prisma.comment.findMany({
      where: { todo: todoWhere },
      select: { todoId: true, authorId: true, createdAt: true },
    }),
    prisma.commentRead.findMany({
      where: { userId, todo: todoWhere },
      select: { todoId: true, lastReadAt: true },
    }),
  ]);
  const commentStats = commentStatsByTodo(comments, commentReads, userId);
  const todos = rows.map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    listId: t.listId,
    // A list suggestion from the retired Inbox list. Captures no longer set
    // it (null in practice); kept so clients that decode it still work.
    suggestedListId: t.suggestedListId,
    projectId: t.projectId,
    projectName: t.project?.name ?? null,
    droppedAt: t.droppedAt,
    isReference: t.isReference,
    snoozedUntil: t.snoozedUntil,
    lastDiscussedAt: t.lastDiscussedAt,
    discussCount: t.discussCount,
    ...todoMeta(t, commentStats),
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      notes: s.notes,
      dueDate: s.dueDate,
      completedAt: s.completedAt,
      creatorName: creatorName(s),
    })),
  }));
  return NextResponse.json({ todos });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await readJsonObject<{
    title?: string;
    listId?: string;
    projectId?: string | null;
    notes?: string;
    dueDate?: string | null;
    parentId?: string | null;
  }>(request);
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
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
    // Post-response: email the other participants if this list is shared.
    after(() =>
      notifySharedListAdd({ todoId: todo.id, listId: todo.listId, creatorId: userId }),
    );
    after(() => syncRecentTodos());
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
      position: await nextTodoPosition(prisma, body.listId),
      notes: body.notes ?? null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      projectId: body.projectId ?? null,
    },
  });
  // Post-response: email the other participants if this list is shared.
  after(() =>
    notifySharedListAdd({ todoId: todo.id, listId: todo.listId, creatorId: userId }),
  );
  after(() => syncRecentTodos());
  return NextResponse.json({ todo });
}
