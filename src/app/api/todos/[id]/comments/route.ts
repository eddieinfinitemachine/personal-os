import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";

export const dynamic = "force-dynamic";

type CommentWithAuthor = {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; name: string | null; email: string };
};

function serialize(c: CommentWithAuthor, userId: string) {
  return {
    id: c.id,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    author: c.author,
    mine: c.author.id === userId,
  };
}

const authorSelect = {
  author: { select: { id: true, name: true, email: true } },
} as const;

// GET — thread for a todo (oldest→newest). Side effect: marks the thread read
// for the current user so its unread badge clears.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const todo = await prisma.todo.findFirst({
    where: { id, list: listAccessWhere(userId) },
    select: { id: true },
  });
  if (!todo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const comments = await prisma.comment.findMany({
    where: { todoId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, createdAt: true, ...authorSelect },
  });

  // Mark read up to now.
  await prisma.commentRead.upsert({
    where: { userId_todoId: { userId, todoId: id } },
    create: { userId, todoId: id },
    update: { lastReadAt: new Date() },
  });

  return NextResponse.json({
    comments: comments.map((c) => serialize(c, userId)),
  });
}

// POST { body } — add a comment authored by the current user.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const todo = await prisma.todo.findFirst({
    where: { id, list: listAccessWhere(userId) },
    select: { id: true },
  });
  if (!todo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const raw = (await request.json()) as { body?: unknown };
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });
  if (body.length > 5000) {
    return NextResponse.json({ error: "comment too long" }, { status: 400 });
  }

  const comment = await prisma.comment.create({
    data: { todoId: id, authorId: userId, body },
    select: { id: true, body: true, createdAt: true, ...authorSelect },
  });

  // Posting implies you've seen everything up to now.
  await prisma.commentRead.upsert({
    where: { userId_todoId: { userId, todoId: id } },
    create: { userId, todoId: id },
    update: { lastReadAt: new Date() },
  });

  return NextResponse.json({ comment: serialize(comment, userId) });
}
