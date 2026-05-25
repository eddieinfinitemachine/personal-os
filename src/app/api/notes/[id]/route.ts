import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json()) as {
    title?: string | null;
    body?: string;
  };
  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const t = body.title?.trim();
    updates.title = t || null;
  }
  if (body.body !== undefined) updates.body = body.body;

  const result = await prisma.note.updateMany({
    where: { id, userId },
    data: updates,
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const note = await prisma.note.findUnique({ where: { id } });
  return NextResponse.json({ note });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await prisma.note.deleteMany({ where: { id, userId } });
  if (result.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
