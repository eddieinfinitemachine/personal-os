import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;

  const allow = new Set([
    "currentMileage",
    "mileageUnit",
    "notes",
    "make",
    "model",
    "year",
    "vin",
    "chassisNumber",
    "engineNumber",
    "assemblyNumber",
    "marketSpec",
    "bodyStyle",
    "exteriorColor",
    "interiorColor",
    "transmission",
    "acquiredAt",
    "acquiredFrom",
    "acquiredPriceUsd",
    "acquiredMileage",
    "insurer",
    "policyNumber",
    "policyEffective",
    "policyExpires",
    "insurerPhone",
  ]);

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (!allow.has(key)) continue;
    const v = body[key];
    if (
      ["acquiredAt", "policyEffective", "policyExpires"].includes(key) &&
      typeof v === "string"
    ) {
      updates[key] = v ? new Date(v) : null;
    } else {
      updates[key] = v;
    }
  }

  const result = await prisma.vehicle.updateMany({
    where: { id, userId },
    data: updates,
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "vehicle not found" }, { status: 404 });
  }
  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  return NextResponse.json({ vehicle });
}
