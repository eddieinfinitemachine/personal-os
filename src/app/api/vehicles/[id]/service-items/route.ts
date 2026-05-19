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
  const body = (await request.json()) as {
    name?: string;
    intervalMonths?: number | null;
    intervalMileage?: number | null;
    notes?: string | null;
    lastPerformedAt?: string | null;
    lastPerformedMileage?: number | null;
  };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle || vehicle.userId !== userId) {
    return NextResponse.json({ error: "vehicle not found" }, { status: 404 });
  }

  const max = await prisma.serviceItem.aggregate({
    where: { vehicleId: id, userId },
    _max: { position: true },
  });

  const item = await prisma.serviceItem.create({
    data: {
      userId,
      vehicleId: id,
      name,
      intervalMonths: body.intervalMonths ?? null,
      intervalMileage: body.intervalMileage ?? null,
      notes: body.notes ?? null,
      lastPerformedAt: body.lastPerformedAt ? new Date(body.lastPerformedAt) : null,
      lastPerformedMileage: body.lastPerformedMileage ?? null,
      position: (max._max.position ?? -1) + 1,
    },
  });
  return NextResponse.json({ item });
}
