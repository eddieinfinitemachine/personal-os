import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const note = await prisma.note.update({ where: { id }, data: updates });
  return NextResponse.json({ note });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.note.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
