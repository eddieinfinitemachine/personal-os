import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; visitId: string }> }
) {
  const { visitId } = await params;
  await prisma.petVetVisit.delete({ where: { id: visitId } });
  return NextResponse.json({ ok: true });
}
