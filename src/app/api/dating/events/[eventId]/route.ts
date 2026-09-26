import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { eventPatch, toEventDTO } from "@/lib/dating-server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ eventId: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { eventId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const res = await prisma.datingEvent.updateMany({ where: { id: eventId, userId }, data: eventPatch(body) });
  if (res.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const event = await prisma.datingEvent.findUniqueOrThrow({ where: { id: eventId } });
  return NextResponse.json({ event: toEventDTO(event) });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { eventId } = await params;
  const res = await prisma.datingEvent.deleteMany({ where: { id: eventId, userId } });
  if (res.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
