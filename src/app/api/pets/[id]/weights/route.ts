import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
      petId: id,
      weightLb: body.weightLb,
      measuredAt: body.measuredAt ? new Date(body.measuredAt) : new Date(),
      notes: body.notes ?? null,
    },
  });
  return NextResponse.json({ weight });
}
