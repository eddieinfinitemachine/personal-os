import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const where: Record<string, unknown> = { archived: false };
  if (kind) where.kind = kind;
  const assets = await prisma.asset.findMany({
    where,
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ assets });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : null;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!kind || !title)
    return NextResponse.json(
      { error: "kind and title required" },
      { status: 400 }
    );

  const max = await prisma.asset.aggregate({
    where: { kind },
    _max: { position: true },
  });
  const snapshot = {
    title,
    subtitle: typeof body.subtitle === "string" ? body.subtitle : null,
    category: typeof body.category === "string" ? body.category : null,
    status: typeof body.status === "string" ? body.status : null,
    amountUsd: typeof body.amountUsd === "number" ? body.amountUsd : null,
    currentValue:
      typeof body.currentValue === "number" ? body.currentValue : null,
    costBasis: typeof body.costBasis === "number" ? body.costBasis : null,
    url: typeof body.url === "string" ? body.url : null,
    imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : null,
    location: typeof body.location === "string" ? body.location : null,
    rating: typeof body.rating === "number" ? body.rating : null,
    acquiredAt:
      typeof body.acquiredAt === "string" ? new Date(body.acquiredAt) : null,
    notes: typeof body.notes === "string" ? body.notes : null,
  };

  const asset = await prisma.asset.create({
    data: {
      kind,
      ...snapshot,
      position: (max._max.position ?? -1) + 1,
    },
  });
  return NextResponse.json({ asset });
}
