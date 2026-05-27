import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// GET — return owner + members. Visible to owner and any current member.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId(request);
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const list = await prisma.list.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!list) return NextResponse.json({ error: "not found" }, { status: 404 });
  const isOwner = list.userId === userId;
  const isMember = list.members.some((m) => m.userId === userId);
  if (!isOwner && !isMember) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    owner: {
      id: list.user.id,
      name: list.user.name,
      email: list.user.email,
    },
    members: list.members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      createdAt: m.createdAt,
    })),
    isOwner,
    listName: list.name,
    isDefault: list.isDefault,
  });
}

// POST — owner invites a user by email. 404 if no account with that email.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId(request);
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const list = await prisma.list.findUnique({ where: { id } });
  if (!list || list.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (list.isDefault) {
    return NextResponse.json(
      { error: "default lists cannot be shared" },
      { status: 400 },
    );
  }

  const body = (await request.json()) as { email?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  const target = await prisma.user.findUnique({ where: { email } });
  if (!target) {
    return NextResponse.json(
      { error: "No account found for that email." },
      { status: 404 },
    );
  }
  if (target.id === userId) {
    return NextResponse.json(
      { error: "You already own this list." },
      { status: 400 },
    );
  }

  const member = await prisma.listMember.upsert({
    where: { listId_userId: { listId: id, userId: target.id } },
    update: {},
    create: { listId: id, userId: target.id, role: "editor" },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return NextResponse.json({
    member: {
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
      createdAt: member.createdAt,
    },
  });
}
