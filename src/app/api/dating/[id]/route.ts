import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { personPatch, toPersonDTO } from "@/lib/dating-server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const res = await prisma.datingPerson.updateMany({ where: { id, userId }, data: personPatch(body) });
  if (res.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const person = await prisma.datingPerson.findUniqueOrThrow({ where: { id } });
  return NextResponse.json({ person: toPersonDTO(person) });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const res = await prisma.datingPerson.deleteMany({ where: { id, userId } });
  if (res.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
