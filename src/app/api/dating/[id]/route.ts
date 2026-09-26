import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { personPatch, personPatchError, toPersonDTO } from "@/lib/dating-server";
import { deleteUserImage } from "@/lib/user-image";
import { datingPhotoFolder } from "@/lib/dating-photos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const invalid = personPatchError(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const res = await prisma.datingPerson.updateMany({ where: { id, userId }, data: personPatch(body) });
  if (res.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const person = await prisma.datingPerson.findUniqueOrThrow({ where: { id } });
  return NextResponse.json({ person: toPersonDTO(person) });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  // Photo rows cascade with the person; their files don't, so collect them first.
  const photos = await prisma.datingPhoto.findMany({ where: { personId: id, userId }, select: { url: true } });
  const res = await prisma.datingPerson.deleteMany({ where: { id, userId } });
  if (res.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await Promise.all(photos.map((p) => deleteUserImage(userId, datingPhotoFolder(id), p.url)));
  return NextResponse.json({ ok: true });
}
