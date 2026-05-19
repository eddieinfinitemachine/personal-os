import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const drives = await prisma.vehicleDrive.findMany({
    where: { vehicleId: id, userId },
    orderBy: { drivenAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ drives });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json()) as {
    distance?: number;
    drivenAt?: string;
    destination?: string | null;
    notes?: string | null;
  };
  const distance = Number(body.distance);
  if (!Number.isFinite(distance) || distance <= 0) {
    return NextResponse.json({ error: "distance required" }, { status: 400 });
  }
  const drivenAt = body.drivenAt ? new Date(body.drivenAt) : new Date();

  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle || vehicle.userId !== userId) {
    return NextResponse.json({ error: "vehicle not found" }, { status: 404 });
  }

  // Wrap the insert + odometer bump so a refresh never sees one without the other.
  const [drive] = await prisma.$transaction([
    prisma.vehicleDrive.create({
      data: {
        userId,
        vehicleId: id,
        distance,
        drivenAt,
        destination: body.destination?.trim() || null,
        notes: body.notes?.trim() || null,
      },
    }),
    prisma.vehicle.update({
      where: { id },
      data: { currentMileage: { increment: distance } },
    }),
  ]);
  return NextResponse.json({ drive });
}
