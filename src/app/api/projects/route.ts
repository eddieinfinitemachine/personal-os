import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const projects = await prisma.project.findMany({
    where: { userId, archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { todos: { where: { completedAt: null } } } },
    },
  });
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    name?: string;
    icon?: string;
    color?: string;
  };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const max = await prisma.project.aggregate({ where: { userId }, _max: { position: true } });
  const position = (max._max.position ?? -1) + 1;

  const project = await prisma.project.create({
    data: {
      userId,
      name,
      icon: body.icon ?? "Folder",
      color: body.color ?? "neutral",
      position,
    },
  });
  revalidateTag(`sidebar-projects:${userId}`, "max");
  return NextResponse.json({ project });
}
