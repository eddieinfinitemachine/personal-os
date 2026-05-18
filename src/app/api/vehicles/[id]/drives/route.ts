import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const drives = await prisma.vehicleDrive.findMany({
    where: { vehicleId: id },
    orderBy: { drivenAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ drives });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  // Wrap the insert + odometer bump so a refresh never sees one without the other.
  const [drive] = await prisma.$transaction([
    prisma.vehicleDrive.create({
      data: {
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
