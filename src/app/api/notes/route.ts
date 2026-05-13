import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const notes = await prisma.note.findMany({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    projectId?: string;
    title?: string;
    body?: string;
  };
  if (!body.projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const note = await prisma.note.create({
    data: {
      projectId: body.projectId,
      title: body.title?.trim() || null,
      body: body.body ?? "",
    },
  });
  return NextResponse.json({ note });
}
