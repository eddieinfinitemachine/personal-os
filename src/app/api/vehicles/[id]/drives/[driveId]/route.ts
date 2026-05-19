import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; driveId: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, driveId } = await params;
  const drive = await prisma.vehicleDrive.findUnique({
    where: { id: driveId },
  });
  if (!drive || drive.vehicleId !== id || drive.userId !== userId) {
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
