import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCoachItems } from "@/lib/coach";
import { computeDue } from "@/lib/maintenance";
import { getCurrentUserId } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    include: {
      serviceItems: { orderBy: { position: "asc" } },
      serviceRecords: { orderBy: { performedAt: "desc" }, take: 5 },
    },
  });
  if (!vehicle || vehicle.userId !== userId) {
    return NextResponse.json({ error: "vehicle not found" }, { status: 404 });
  }

  const today = new Date();
  const overdue: string[] = [];
  const dueSoon: string[] = [];
  for (const item of vehicle.serviceItems) {
    const due = computeDue(item, vehicle.currentMileage, today);
    if (due.status === "overdue") overdue.push(item.name);
    else if (due.status === "due-soon") dueSoon.push(item.name);
  }

  const summary = [
    `Today: ${today.toISOString().slice(0, 10)} (season: ${seasonOf(today)})`,
    `Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    vehicle.bodyStyle ? `Body: ${vehicle.bodyStyle}` : null,
    vehicle.transmission ? `Transmission: ${vehicle.transmission}` : null,
    vehicle.marketSpec ? `Market: ${vehicle.marketSpec}` : null,
    vehicle.exteriorColor ? `Color: ${vehicle.exteriorColor}` : null,
    vehicle.currentMileage != null
      ? `Current odometer: ${vehicle.currentMileage.toLocaleString()} ${vehicle.mileageUnit}`
      : null,
    vehicle.acquiredAt
      ? `Acquired: ${new Date(vehicle.acquiredAt).toISOString().slice(0, 10)}${
          vehicle.acquiredMileage
            ? ` at ${vehicle.acquiredMileage.toLocaleString()} ${vehicle.mileageUnit}`
            : ""
        }`
      : null,
    overdue.length > 0 ? `Overdue maintenance: ${overdue.join(", ")}` : null,
    dueSoon.length > 0 ? `Due-soon maintenance: ${dueSoon.join(", ")}` : null,
    vehicle.serviceRecords.length > 0
      ? `Recent service: ${vehicle.serviceRecords
          .map(
            (r) =>
              `${new Date(r.performedAt).toISOString().slice(0, 10)} (${
                r.mileage ? `${r.mileage} ${vehicle.mileageUnit}, ` : ""
              }${r.shop ?? "no shop"}): ${r.workSummary.slice(0, 100)}`
          )
          .join(" | ")}`
      : null,
    vehicle.policyExpires
      ? `Insurance expires: ${new Date(vehicle.policyExpires).toISOString().slice(0, 10)}`
      : null,
    vehicle.notes ? `Owner notes: ${vehicle.notes.slice(0, 600)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  let items;
  try {
    items = await generateCoachItems(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "coach failed" },
      { status: 502 }
    );
  }

  await prisma.recommendation.deleteMany({
    where: { vehicleId: id, completedAt: null, dismissedAt: null },
  });

  await prisma.recommendation.createMany({
    data: items.map((i, idx) => ({
      userId,
      scope: "vehicle",
      vehicleId: id,
      title: i.title,
      body: i.body ?? null,
      priority: i.priority ?? "normal",
      cadence: i.cadence ?? "one-time",
      position: idx,
    })),
  });

  const recommendations = await prisma.recommendation.findMany({
    where: { vehicleId: id, completedAt: null, dismissedAt: null },
    orderBy: { position: "asc" },
  });
  return NextResponse.json({ recommendations });
}

function seasonOf(d: Date): string {
  const m = d.getMonth();
  if (m <= 1 || m === 11) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "autumn";
}
