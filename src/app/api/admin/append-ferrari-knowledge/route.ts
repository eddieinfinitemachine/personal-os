import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const APPEND_NOTES = `

Engine Warmup (dry sump)
The 456 has a dry-sump oiling system, so let the car run at idle for at least 5 minutes before driving or changing gears. The oil needs that time to distribute through the system. (Supersedes the 30–60 second guidance below — be patient.)

Oil & Coolant
Engine oil and coolant were last changed in July 2025. Worth checking levels and topping up every few months as needed — both are normal-wear consumables on this car. Manual covers the procedures, but FerrariChat (FChat) 456 sub-forum is often clearer than the manual for owner-level work.

Interior Leather
Care for the original tan leather with Connolly Leather products (cleaner + conditioner) — use as directed. Don't substitute generic leather treatments.

Audio
Bluetooth audio is set up and works.

Windows (frameless)
The doors have frameless windows. Never slam them — close gently. Hand-wash the car only. The previous owner has never used a car wash and that's the right policy.

Suspension Warning Light (false-positive)
The suspension light comes on after the third engine start without driving the car between starts. This is normal — it's a known artifact, not a fault. Drive the car and the light clears. Don't go diagnosing it.

Ashtrays
Few 456s have both ashtrays working. The FRONT is actually a simple mechanism — fixable with a single ~$8 part (the part is hard to source, but the previous owner has included a couple in the parts box). The REAR is more involved; reach out to the previous owner for the procedure when ready. Parts are in the box that came with the car.

Before Booking Service
When vetting a new shop for this car, confirm two things up front:
1. Do they have the SD2 scanner for older Ferraris?
2. Do they have direct experience with the 456 or contemporary V12s? (This car has many quirks an experienced tech handles instinctively that someone learning will miss.)
If they can't answer both yes, find another shop.`;

export async function POST() {
  const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const founder = await prisma.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) return NextResponse.json({ error: "founder user missing" }, { status: 500 });
  const userId = founder.id;

  const vehicle = await prisma.vehicle.findFirst({
    where: { userId, project: { name: "Ferrari 456 GT" } },
    include: { serviceItems: true },
  });
  if (!vehicle) {
    return NextResponse.json({ error: "Ferrari vehicle not found" }, { status: 404 });
  }

  const julyChange = new Date("2025-07-01");

  // 1) Service record for July 2025 oil & coolant change.
  await prisma.serviceRecord.create({
    data: {
      vehicleId: vehicle.id,
      userId,
      performedAt: julyChange,
      mileage: null,
      shop: "Previous owner",
      workSummary:
        "Engine oil and coolant changed/topped up by previous owner. (Logged retroactively from owner notes.)",
    },
  });

  // 2) Bump matching service items' lastPerformedAt so the dashboard recomputes.
  const oilItem = vehicle.serviceItems.find((i) => /oil & filter/i.test(i.name));
  const coolantItem = vehicle.serviceItems.find((i) => /coolant flush/i.test(i.name));
  if (oilItem && julyChange > (oilItem.lastPerformedAt ?? new Date(0))) {
    await prisma.serviceItem.update({
      where: { id: oilItem.id },
      data: { lastPerformedAt: julyChange },
    });
  }
  if (coolantItem && julyChange > (coolantItem.lastPerformedAt ?? new Date(0))) {
    await prisma.serviceItem.update({
      where: { id: coolantItem.id },
      data: { lastPerformedAt: julyChange },
    });
  }

  // 3) Append notes — only if we haven't already (idempotent on the marker text).
  const marker = "Engine Warmup (dry sump)";
  const currentNotes = vehicle.notes ?? "";
  if (!currentNotes.includes(marker)) {
    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { notes: currentNotes + APPEND_NOTES },
    });
  }

  return NextResponse.json({
    ok: true,
    serviceRecordCreated: true,
    oilUpdated: !!oilItem,
    coolantUpdated: !!coolantItem,
    notesAppended: !currentNotes.includes(marker),
  });
}
