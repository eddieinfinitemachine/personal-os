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
  const existing = await prisma.person.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await request.json()) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const k of [
    "firstName",
    "lastName",
    "strength",
    "email",
    "phone",
    "company",
    "role",
    "city",
    "country",
    "howWeMet",
    "notes",
    "imageUrl",
  ]) {
    if (typeof body[k] === "string" || body[k] === null) data[k] = body[k];
  }
  if (Array.isArray(body.circles)) data.circles = body.circles;
  if (Array.isArray(body.interests)) data.interests = body.interests;
  if (Array.isArray(body.tags)) data.tags = body.tags;
  if (typeof body.archived === "boolean") data.archived = body.archived;
  if (typeof body.starred === "boolean") data.starred = body.starred;
  if (body.socialUrls === null) {
    data.socialUrls = null;
  } else if (typeof body.socialUrls === "object" && body.socialUrls !== null) {
    data.socialUrls = body.socialUrls;
  }
  for (const k of ["birthday", "lastInteractionAt"]) {
    if (body[k] === null) data[k] = null;
    else if (typeof body[k] === "string") data[k] = new Date(body[k] as string);
  }

  const person = await prisma.person.update({ where: { id }, data });
  return NextResponse.json({ person });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.person.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.person.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
