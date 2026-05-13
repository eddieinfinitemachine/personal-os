import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as {
    title?: string;
    link?: string | null;
    priceUsd?: number | null;
    quantity?: number | null;
    notes?: string | null;
  };
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const max = await prisma.shoppingItem.aggregate({
    where: { vehicleId: id },
    _max: { position: true },
  });

  const item = await prisma.shoppingItem.create({
    data: {
      vehicleId: id,
      title,
      link: body.link?.trim() || null,
      priceUsd: body.priceUsd ?? null,
      quantity: body.quantity ?? 1,
      notes: body.notes?.trim() || null,
      position: (max._max.position ?? -1) + 1,
    },
  });
  return NextResponse.json({ item });
}
