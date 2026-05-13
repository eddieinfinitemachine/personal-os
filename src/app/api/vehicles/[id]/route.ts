import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const vehicle = await prisma.vehicle.update({ where: { id }, data: updates });
  return NextResponse.json({ vehicle });
}
