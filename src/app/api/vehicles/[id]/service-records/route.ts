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
    performedAt?: string;
    mileage?: number | null;
    shop?: string | null;
    workSummary?: string;
    details?: string | null;
    costUsd?: number | null;
    serviceItemIds?: string[];
  };
  const workSummary = body.workSummary?.trim();
  if (!workSummary) {
    return NextResponse.json({ error: "workSummary required" }, { status: 400 });
  }
  const performedAt = body.performedAt ? new Date(body.performedAt) : new Date();

  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle || vehicle.userId !== userId) {
    return NextResponse.json({ error: "vehicle not found" }, { status: 404 });
  }

  const record = await prisma.serviceRecord.create({
    data: {
      userId,
      vehicleId: id,
      performedAt,
      mileage: body.mileage ?? null,
      shop: body.shop ?? null,
      workSummary,
      details: body.details ?? null,
      costUsd: body.costUsd ?? null,
    },
  });

  // Roll updates onto specific maintenance items so the proactive
  // recommendations recompute immediately.
  if (body.serviceItemIds && body.serviceItemIds.length > 0) {
    await prisma.serviceItem.updateMany({
      where: { id: { in: body.serviceItemIds }, vehicleId: id, userId },
      data: {
        lastPerformedAt: performedAt,
        lastPerformedMileage: body.mileage ?? null,
      },
    });
  }

  // If a mileage was logged and it's higher than the current odometer, advance it.
  if (body.mileage != null) {
    await prisma.vehicle.updateMany({
      where: { id, userId, currentMileage: { lt: body.mileage } },
      data: { currentMileage: body.mileage },
    });
  }

  return NextResponse.json({ record });
}
