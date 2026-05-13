import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/storage";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { photoId } = await params;
  const photo = await prisma.vehiclePhoto.findUnique({ where: { id: photoId } });
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.vehiclePhoto.delete({ where: { id: photoId } });
  await deleteFile(photo.url);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { photoId } = await params;
  const body = (await request.json()) as { caption?: string | null };
  const photo = await prisma.vehiclePhoto.update({
    where: { id: photoId },
    data: { caption: body.caption?.trim() || null },
  });
  return NextResponse.json({ photo });
}
