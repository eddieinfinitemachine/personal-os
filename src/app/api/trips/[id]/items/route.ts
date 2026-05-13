import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "note";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  const max = await prisma.tripItem.aggregate({
    where: { tripId: id },
    _max: { position: true },
  });
  const item = await prisma.tripItem.create({
    data: {
      tripId: id,
      kind,
      title,
      startAt:
        typeof body.startAt === "string" && body.startAt
          ? new Date(body.startAt)
          : null,
      endAt:
        typeof body.endAt === "string" && body.endAt
          ? new Date(body.endAt)
          : null,
      location: typeof body.location === "string" ? body.location : null,
      fromLocation:
        typeof body.fromLocation === "string" ? body.fromLocation : null,
      toLocation:
        typeof body.toLocation === "string" ? body.toLocation : null,
      confirmation:
        typeof body.confirmation === "string" ? body.confirmation : null,
      url: typeof body.url === "string" ? body.url : null,
      costUsd: typeof body.costUsd === "number" ? body.costUsd : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      position: (max._max.position ?? -1) + 1,
    },
  });
  return NextResponse.json({ item });
}
