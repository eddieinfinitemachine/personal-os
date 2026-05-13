import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDefaultLists, isListColor } from "@/lib/lists";

export async function GET() {
  await ensureDefaultLists();
  const lists = await prisma.list.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ lists });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string; color?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const color = body.color && isListColor(body.color) ? body.color : "zinc";
  const max = await prisma.list.aggregate({ _max: { position: true } });
  const position = (max._max.position ?? -1) + 1;

  const list = await prisma.list.create({
    data: { name, color, position },
  });
  return NextResponse.json({ list });
}
