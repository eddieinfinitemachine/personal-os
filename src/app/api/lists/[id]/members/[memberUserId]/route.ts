import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// DELETE — owner can remove anyone; a member can remove themselves.
// The owner can never be "removed" (they own the list; to terminate the
// share, delete the list or remove individual members).
export async function DELETE(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; memberUserId: string }> },
) {
  const userId = await getCurrentUserId(request);
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, memberUserId } = await params;
  const list = await prisma.list.findUnique({ where: { id } });
  if (!list) return NextResponse.json({ error: "not found" }, { status: 404 });

  const isOwner = list.userId === userId;
  const isSelfRemoval = userId === memberUserId;
  if (!isOwner && !isSelfRemoval) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (memberUserId === list.userId) {
    return NextResponse.json(
      { error: "Cannot remove the list owner." },
      { status: 400 },
    );
  }

  const result = await prisma.listMember.deleteMany({
    where: { listId: id, userId: memberUserId },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "not a member" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
