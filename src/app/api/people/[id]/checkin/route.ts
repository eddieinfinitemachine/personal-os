import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const person = await prisma.person.update({
    where: { id },
    data: { lastInteractionAt: new Date() },
  });
  return NextResponse.json({ person });
}
