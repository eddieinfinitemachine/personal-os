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
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await request.json()) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const k of [
    "title",
    "subtitle",
    "category",
    "status",
    "url",
    "imageUrl",
    "location",
    "notes",
  ]) {
    if (typeof body[k] === "string" || body[k] === null) data[k] = body[k];
  }
  for (const k of ["amountUsd", "currentValue", "costBasis", "rating"]) {
    if (typeof body[k] === "number" || body[k] === null) data[k] = body[k];
  }
  if (typeof body.archived === "boolean") data.archived = body.archived;
  if (body.acquiredAt !== undefined) {
    data.acquiredAt = body.acquiredAt ? new Date(body.acquiredAt as string) : null;
  }
  const asset = await prisma.asset.update({ where: { id }, data });
  return NextResponse.json({ asset });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.asset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
