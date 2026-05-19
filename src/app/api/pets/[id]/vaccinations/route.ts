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
    name?: string;
    administeredAt?: string;
    boosterDueAt?: string | null;
    vet?: string | null;
    notes?: string | null;
  };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const vaccination = await prisma.petVaccination.create({
    data: {
      userId,
      petId: id,
      name,
      administeredAt: body.administeredAt ? new Date(body.administeredAt) : new Date(),
      boosterDueAt: body.boosterDueAt ? new Date(body.boosterDueAt) : null,
      vet: body.vet ?? null,
      notes: body.notes ?? null,
    },
  });
  return NextResponse.json({ vaccination });
}
