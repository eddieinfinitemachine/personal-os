import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { contactId } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const allow = ["name", "role", "address", "phone", "email", "website", "notes"];
  const updates: Record<string, unknown> = {};
  for (const k of allow) if (body[k] !== undefined) updates[k] = body[k];

  const existing = await prisma.vehicleContact.findUnique({ where: { id: contactId } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const contact = await prisma.vehicleContact.update({
    where: { id: contactId },
    data: updates,
  });
  return NextResponse.json({ contact });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { contactId } = await params;
  const result = await prisma.vehicleContact.deleteMany({
    where: { id: contactId, userId },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
