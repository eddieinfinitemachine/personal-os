import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const max = await prisma.trip.aggregate({ _max: { position: true } });
  const trip = await prisma.trip.create({
    data: {
      name,
      destination:
        typeof body.destination === "string" ? body.destination.trim() : null,
      startDate:
        typeof body.startDate === "string" && body.startDate
          ? new Date(body.startDate)
          : null,
      endDate:
        typeof body.endDate === "string" && body.endDate
          ? new Date(body.endDate)
          : null,
      status: typeof body.status === "string" ? body.status : "planned",
      travelers: Array.isArray(body.travelers)
        ? (body.travelers as unknown[]).filter(
            (v): v is string => typeof v === "string"
          )
        : [],
      transport: typeof body.transport === "string" ? body.transport : null,
      accommodation:
        typeof body.accommodation === "string" ? body.accommodation : null,
      costUsd: typeof body.costUsd === "number" ? body.costUsd : null,
      bookingUrl: typeof body.bookingUrl === "string" ? body.bookingUrl : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : null,
      position: (max._max.position ?? -1) + 1,
    },
  });

  return NextResponse.json({ trip });
}
