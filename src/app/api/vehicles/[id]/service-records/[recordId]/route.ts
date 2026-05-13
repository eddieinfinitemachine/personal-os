import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> }
) {
  const { recordId } = await params;
  await prisma.serviceRecord.delete({ where: { id: recordId } });
  return NextResponse.json({ ok: true });
}
