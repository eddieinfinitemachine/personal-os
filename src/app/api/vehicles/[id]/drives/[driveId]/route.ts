import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; driveId: string }> }
) {
  const { id, driveId } = await params;
  const drive = await prisma.vehicleDrive.findUnique({
    where: { id: driveId },
  });
  if (!drive || drive.vehicleId !== id) {
    return NextResponse.json({ error: "drive not found" }, { status: 404 });
  }
  await prisma.$transaction([
    prisma.vehicleDrive.delete({ where: { id: driveId } }),
    prisma.vehicle.update({
      where: { id },
      data: { currentMileage: { decrement: drive.distance } },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
