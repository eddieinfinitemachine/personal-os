import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet || pet.userId !== userId) {
    return NextResponse.json({ error: "pet not found" }, { status: 404 });
  }
  const body = (await request.json()) as {
    performedAt?: string;
    reason?: string;
    vet?: string | null;
    details?: string | null;
    costUsd?: number | null;
  };
  const reason = body.reason?.trim();
  if (!reason) return NextResponse.json({ error: "reason required" }, { status: 400 });
  const visit = await prisma.petVetVisit.create({
    data: {
      userId,
      petId: id,
      performedAt: body.performedAt ? new Date(body.performedAt) : new Date(),
      reason,
      vet: body.vet ?? null,
      details: body.details ?? null,
      costUsd: body.costUsd ?? null,
    },
  });
  return NextResponse.json({ visit });
}
