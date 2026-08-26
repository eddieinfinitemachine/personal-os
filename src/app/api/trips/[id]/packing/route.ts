import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip || trip.userId !== userId) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }
  const items = await prisma.packingItem.findMany({
    where: { tripId: id },
    orderBy: [{ category: "asc" }, { position: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ items });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip || trip.userId !== userId) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }
  const body = (await request.json()) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  const category =
    typeof body.category === "string" && body.category.trim()
      ? body.category.trim()
      : "Other";
  const quantity =
    typeof body.quantity === "number" && body.quantity >= 1
      ? Math.min(Math.round(body.quantity), 99)
      : 1;
  const max = await prisma.packingItem.aggregate({
    where: { tripId: id },
    _max: { position: true },
  });
  const item = await prisma.packingItem.create({
    data: {
      userId,
      tripId: id,
      title,
      category,
      quantity,
      notes: typeof body.notes === "string" ? body.notes : null,
      position: (max._max.position ?? -1) + 1,
    },
  });
  return NextResponse.json({ item });
}
