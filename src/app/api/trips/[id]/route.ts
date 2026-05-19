import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.trip.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await request.json()) as Record<string, unknown>;

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim();
  if (body.destination !== undefined)
    data.destination =
      typeof body.destination === "string" ? body.destination : null;
  if (body.startDate !== undefined)
    data.startDate =
      typeof body.startDate === "string" && body.startDate
        ? new Date(body.startDate)
        : null;
  if (body.endDate !== undefined)
    data.endDate =
      typeof body.endDate === "string" && body.endDate
        ? new Date(body.endDate)
        : null;
  if (typeof body.status === "string") data.status = body.status;
  if (Array.isArray(body.travelers))
    data.travelers = (body.travelers as unknown[]).filter(
      (v): v is string => typeof v === "string"
    );
  if (body.transport !== undefined)
    data.transport = typeof body.transport === "string" ? body.transport : null;
  if (body.accommodation !== undefined)
    data.accommodation =
      typeof body.accommodation === "string" ? body.accommodation : null;
  if (body.costUsd !== undefined)
    data.costUsd = typeof body.costUsd === "number" ? body.costUsd : null;
  if (body.bookingUrl !== undefined)
    data.bookingUrl =
      typeof body.bookingUrl === "string" ? body.bookingUrl : null;
  if (body.notes !== undefined)
    data.notes = typeof body.notes === "string" ? body.notes : null;
  if (body.imageUrl !== undefined)
    data.imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : null;
  if (typeof body.archived === "boolean") data.archived = body.archived;
  if (typeof body.position === "number") data.position = body.position;

  const trip = await prisma.trip.update({ where: { id }, data });
  return NextResponse.json({ trip });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.trip.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.trip.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
