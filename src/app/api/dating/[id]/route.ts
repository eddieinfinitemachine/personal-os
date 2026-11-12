import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { personPatch, personPatchError, toEventDTO, toPersonDTO } from "@/lib/dating-server";
import { deleteUserImage } from "@/lib/user-image";
import { datingPhotoFolder, toPhotoDTO } from "@/lib/dating-photos";

import {updateWithIdentity,removeWithIdentity} from "@/lib/dating-intake/people";
import {refreshDatingInsights} from "@/lib/dating-insights";
import {failure} from "@/lib/dating-intake/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET → one person's page for the native app: the profile, the timeline
// (oldest first) and the photos (newest first), as /dating/[id] loads them.
// Messages have their own paged route.
export async function GET(request: Request, { params }: Ctx) {
  const headers = { "Cache-Control": "private, no-store" };
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const { id } = await params;
  const person = await prisma.datingPerson.findFirst({ where: { id, userId } });
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404, headers });
  const [events, photos] = await Promise.all([
    prisma.datingEvent.findMany({ where: { personId: id, userId }, orderBy: { occurredAt: "asc" } }),
    prisma.datingPhoto.findMany({ where: { personId: id, userId }, orderBy: { createdAt: "desc" } }),
  ]);
  return NextResponse.json(
    { person: toPersonDTO(person), events: events.map(toEventDTO), photos: photos.map(toPhotoDTO) },
    { headers },
  );
}

export async function PATCH(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const invalid = personPatchError(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  let person;
  try { person = await updateWithIdentity(userId,id,personPatch(body)); } catch(e) { return failure(e); }
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404 });
  after(async()=>{try{await refreshDatingInsights(userId,id,{onlyIfStale:true});}catch{console.error("Dating summary refresh failed");}});
  return NextResponse.json({ person: toPersonDTO(person) });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  // Photo rows cascade with the person; their files don't, so collect them first.
  const photos = await prisma.datingPhoto.findMany({ where: { personId: id, userId }, select: { url: true } });
  const removed = await removeWithIdentity(userId,id,new URL(request.url).searchParams.get("exclude")==="true");
  if (!removed) return NextResponse.json({ error: "not found" }, { status: 404 });
  await Promise.all(photos.map((p) => deleteUserImage(userId, datingPhotoFolder(id), p.url)));
  return NextResponse.json({ ok: true });
}
