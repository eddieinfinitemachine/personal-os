import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; vaxId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { vaxId } = await params;
  const existing = await prisma.petVaccination.findUnique({ where: { id: vaxId } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await request.json()) as {
    name?: string;
    administeredAt?: string;
    boosterDueAt?: string | null;
    vet?: string | null;
    notes?: string | null;
  };
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.administeredAt !== undefined)
    updates.administeredAt = new Date(body.administeredAt);
  if (body.boosterDueAt !== undefined)
    updates.boosterDueAt = body.boosterDueAt ? new Date(body.boosterDueAt) : null;
  if (body.vet !== undefined) updates.vet = body.vet;
  if (body.notes !== undefined) updates.notes = body.notes;
  const vaccination = await prisma.petVaccination.update({
    where: { id: vaxId },
    data: updates,
  });
  return NextResponse.json({ vaccination });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; vaxId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { vaxId } = await params;
  const existing = await prisma.petVaccination.findUnique({ where: { id: vaxId } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.petVaccination.delete({ where: { id: vaxId } });
  return NextResponse.json({ ok: true });
}
