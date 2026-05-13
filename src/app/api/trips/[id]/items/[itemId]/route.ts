import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof body.kind === "string") data.kind = body.kind;
  if (typeof body.title === "string") data.title = body.title;
  if (body.startAt !== undefined)
    data.startAt =
      typeof body.startAt === "string" && body.startAt
        ? new Date(body.startAt)
        : null;
  if (body.endAt !== undefined)
    data.endAt =
      typeof body.endAt === "string" && body.endAt
        ? new Date(body.endAt)
        : null;
  if (body.location !== undefined)
    data.location = typeof body.location === "string" ? body.location : null;
  if (body.fromLocation !== undefined)
    data.fromLocation =
      typeof body.fromLocation === "string" ? body.fromLocation : null;
  if (body.toLocation !== undefined)
    data.toLocation =
      typeof body.toLocation === "string" ? body.toLocation : null;
  if (body.confirmation !== undefined)
    data.confirmation =
      typeof body.confirmation === "string" ? body.confirmation : null;
  if (body.url !== undefined)
    data.url = typeof body.url === "string" ? body.url : null;
  if (body.costUsd !== undefined)
    data.costUsd = typeof body.costUsd === "number" ? body.costUsd : null;
  if (body.notes !== undefined)
    data.notes = typeof body.notes === "string" ? body.notes : null;
  if (body.completedAt !== undefined)
    data.completedAt =
      typeof body.completedAt === "string" && body.completedAt
        ? new Date(body.completedAt)
        : null;
  if (body.toggleComplete) {
    const existing = await prisma.tripItem.findUnique({
      where: { id: itemId },
    });
    if (existing) {
      data.completedAt = existing.completedAt ? null : new Date();
    }
  }
  if (typeof body.position === "number") data.position = body.position;

  const item = await prisma.tripItem.update({ where: { id: itemId }, data });
  return NextResponse.json({ item });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { itemId } = await params;
  await prisma.tripItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
