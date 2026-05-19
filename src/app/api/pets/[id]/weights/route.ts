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
    measuredAt?: string;
    weightLb?: number;
    notes?: string | null;
  };
  if (typeof body.weightLb !== "number") {
    return NextResponse.json({ error: "weightLb required" }, { status: 400 });
  }
  const weight = await prisma.petWeight.create({
    data: {
      userId,
      petId: id,
      weightLb: body.weightLb,
      measuredAt: body.measuredAt ? new Date(body.measuredAt) : new Date(),
      notes: body.notes ?? null,
    },
  });
  return NextResponse.json({ weight });
}
