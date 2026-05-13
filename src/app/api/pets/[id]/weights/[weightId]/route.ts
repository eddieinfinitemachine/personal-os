import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; weightId: string }> }
) {
  const { weightId } = await params;
  await prisma.petWeight.delete({ where: { id: weightId } });
  return NextResponse.json({ ok: true });
}
