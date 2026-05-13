import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = (await request.json()) as { ids?: string[] };
  if (!Array.isArray(body.ids)) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  await prisma.$transaction(
    body.ids.map((id, position) =>
      prisma.list.update({ where: { id }, data: { position } })
    )
  );
  return NextResponse.json({ ok: true });
}
