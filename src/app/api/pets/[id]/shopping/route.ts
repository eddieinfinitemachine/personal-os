import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet || pet.userId !== userId) {
    return NextResponse.json({ error: "pet not found" }, { status: 404 });
  }
  const body = (await request.json()) as {
    title?: string;
    link?: string | null;
    priceUsd?: number | null;
    quantity?: number | null;
    notes?: string | null;
  };
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const max = await prisma.petShoppingItem.aggregate({
    where: { petId: id },
    _max: { position: true },
  });

  const item = await prisma.petShoppingItem.create({
    data: {
      userId,
      petId: id,
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
