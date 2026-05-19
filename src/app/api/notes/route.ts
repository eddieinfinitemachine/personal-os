import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const notes = await prisma.note.findMany({
    where: { userId, projectId },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    projectId?: string;
    title?: string;
    body?: string;
  };
  if (!body.projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const note = await prisma.note.create({
    data: {
      userId,
      projectId: body.projectId,
      title: body.title?.trim() || null,
      body: body.body ?? "",
    },
  });
  return NextResponse.json({ note });
}
