import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

// DELETE — a comment can be removed by its author or by the owner of the todo's
// list (so a list owner can moderate a shared thread).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const comment = await prisma.comment.findUnique({
    where: { id },
    select: { id: true, authorId: true, todo: { select: { list: { select: { userId: true } } } } },
  });
  if (!comment) return NextResponse.json({ error: "not found" }, { status: 404 });

  const isAuthor = comment.authorId === userId;
  const isListOwner = comment.todo.list.userId === userId;
  if (!isAuthor && !isListOwner) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.comment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
