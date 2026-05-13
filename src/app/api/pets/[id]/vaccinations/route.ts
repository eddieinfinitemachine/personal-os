import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
