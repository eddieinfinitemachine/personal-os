import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDefaultLists, isListColor } from "@/lib/lists";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";
import { listSharing } from "@/lib/home-meta";

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await ensureDefaultLists(userId);
  const rows = await prisma.list.findMany({
    where: listAccessWhere(userId),
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      // Hint for the UI: shared lists show a small chip + the owner's name.
      user: { select: { id: true, name: true, email: true } },
      // Every member: the owner sees who it's shared with, and the caller's
      // own row carries their personal tile color.
      members: {
        select: { userId: true, color: true, user: { select: { name: true, email: true } } },
      },
      _count: { select: { members: true } },
    },
  });
  const lists = rows.map((l) => {
    // shared, ownerName, collaborative, sharedWithNames: as on the web Home.
    const sharing = listSharing(l, userId);
    return {
      id: l.id,
      name: l.name,
      color:
        (sharing.shared ? l.members.find((m) => m.userId === userId)?.color : null) ??
        l.color,
      position: l.position,
      isDefault: l.isDefault,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      userId: l.userId,
      ...sharing,
    };
  });
  return NextResponse.json({ lists });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as { name?: string; color?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const color = body.color && isListColor(body.color) ? body.color : "zinc";
  const max = await prisma.list.aggregate({ where: { userId }, _max: { position: true } });
  const position = (max._max.position ?? -1) + 1;

  const list = await prisma.list.create({
    data: { userId, name, color, position },
  });
  return NextResponse.json({ list });
}
