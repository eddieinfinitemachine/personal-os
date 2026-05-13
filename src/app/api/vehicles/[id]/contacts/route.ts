import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    role?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    notes?: string | null;
  };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const max = await prisma.vehicleContact.aggregate({
    where: { vehicleId: id },
    _max: { position: true },
  });

  const contact = await prisma.vehicleContact.create({
    data: {
      vehicleId: id,
      name,
      role: body.role ?? null,
      address: body.address ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      website: body.website ?? null,
      notes: body.notes ?? null,
      position: (max._max.position ?? -1) + 1,
    },
  });
  return NextResponse.json({ contact });
}
