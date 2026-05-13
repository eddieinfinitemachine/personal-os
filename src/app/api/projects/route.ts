import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const projects = await prisma.project.findMany({
    where: { archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { todos: { where: { completedAt: null } } } },
    },
  });
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    icon?: string;
    color?: string;
  };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const max = await prisma.project.aggregate({ _max: { position: true } });
  const position = (max._max.position ?? -1) + 1;

  const project = await prisma.project.create({
    data: {
      name,
      icon: body.icon ?? "Folder",
      color: body.color ?? "neutral",
      position,
    },
  });
  revalidateTag("sidebar-projects", "max");
  return NextResponse.json({ project });
}
