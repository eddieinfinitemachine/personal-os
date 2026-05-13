import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { contactId } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const allow = ["name", "role", "address", "phone", "email", "website", "notes"];
  const updates: Record<string, unknown> = {};
  for (const k of allow) if (body[k] !== undefined) updates[k] = body[k];
  const contact = await prisma.vehicleContact.update({
    where: { id: contactId },
    data: updates,
  });
  return NextResponse.json({ contact });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { contactId } = await params;
  await prisma.vehicleContact.delete({ where: { id: contactId } });
  return NextResponse.json({ ok: true });
}
