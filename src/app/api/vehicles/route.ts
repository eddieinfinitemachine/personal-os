import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as Record<string, unknown>;
  const make = typeof body.make === "string" ? body.make.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const yearRaw = body.year;
  const year =
    typeof yearRaw === "number"
      ? yearRaw
      : typeof yearRaw === "string"
        ? Number(yearRaw)
        : Number.NaN;
  if (!make || !model || !Number.isFinite(year)) {
    return NextResponse.json(
      { error: "make, model, year required" },
      { status: 400 }
    );
  }

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : `${year} ${make} ${model}`;

  const max = await prisma.project.aggregate({ where: { userId }, _max: { position: true } });
  const project = await prisma.project.create({
    data: {
      userId,
      name,
      kind: "vehicle",
      icon: "Car",
      color: typeof body.color === "string" ? body.color : "neutral",
      position: (max._max.position ?? -1) + 1,
    },
  });

  const vehicle = await prisma.vehicle.create({
    data: {
      userId,
      projectId: project.id,
      make,
      model,
      year,
      bodyStyle: typeof body.bodyStyle === "string" ? body.bodyStyle : null,
      exteriorColor:
        typeof body.exteriorColor === "string" ? body.exteriorColor : null,
      transmission:
        typeof body.transmission === "string" ? body.transmission : null,
      vin: typeof body.vin === "string" ? body.vin : null,
      currentMileage:
        typeof body.currentMileage === "number" ? body.currentMileage : null,
      mileageUnit: typeof body.mileageUnit === "string" ? body.mileageUnit : "mi",
      acquiredAt:
        typeof body.acquiredAt === "string" ? new Date(body.acquiredAt) : null,
      acquiredPriceUsd:
        typeof body.acquiredPriceUsd === "number" ? body.acquiredPriceUsd : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  });

  revalidateTag("sidebar-projects", "max");
  return NextResponse.json({ projectId: project.id, vehicleId: vehicle.id });
}
