import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDefaultLists, isListColor } from "@/lib/lists";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";

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
    },
  });
  const lists = rows.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    position: l.position,
    isDefault: l.isDefault,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    userId: l.userId,
    shared: l.userId !== userId,
    ownerName: l.userId === userId ? null : l.user.name ?? l.user.email,
  }));
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
