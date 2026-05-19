import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/storage";
import { getCurrentUserId } from "@/lib/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { photoId } = await params;
  const photo = await prisma.petPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.userId !== userId) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.petPhoto.delete({ where: { id: photoId } });
  await deleteFile(photo.url);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { photoId } = await params;
  const body = (await request.json()) as { caption?: string | null };
  const existing = await prisma.petPhoto.findUnique({ where: { id: photoId } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const photo = await prisma.petPhoto.update({
    where: { id: photoId },
    data: { caption: body.caption?.trim() || null },
  });
  return NextResponse.json({ photo });
}
