import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;

  const allow = new Set([
    "name",
    "species",
    "breed",
    "sex",
    "color",
    "birthDate",
    "microchipId",
    "spayedNeuteredAt",
    "feedingSchedule",
    "notes",
    "vetClinic",
    "vetPhone",
    "vetAddress",
  ]);

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (!allow.has(key)) continue;
    const v = body[key];
    if (
      ["birthDate", "spayedNeuteredAt"].includes(key) &&
      typeof v === "string"
    ) {
      updates[key] = v ? new Date(v) : null;
    } else {
      updates[key] = v;
    }
  }

  const pet = await prisma.pet.update({ where: { id }, data: updates });
  return NextResponse.json({ pet });
}
