import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { deleteUserImage } from "@/lib/user-image";
import { cleanCaption, datingPhotoFolder, toPhotoDTO } from "@/lib/dating-photos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ photoId: string }> };

// PATCH { caption } → set or clear (empty string / null) the caption.
export async function PATCH(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { photoId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!("caption" in body)) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  const res = await prisma.datingPhoto.updateMany({
    where: { id: photoId, userId },
    data: { caption: cleanCaption(body.caption) },
  });
  if (res.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const photo = await prisma.datingPhoto.findUniqueOrThrow({ where: { id: photoId } });
  return NextResponse.json({ photo: toPhotoDTO(photo) });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { photoId } = await params;
  const photo = await prisma.datingPhoto.findFirst({ where: { id: photoId, userId } });
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.datingPhoto.delete({ where: { id: photo.id } });
  await deleteUserImage(userId, datingPhotoFolder(photo.personId), photo.url);
  return NextResponse.json({ ok: true });
}
