import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = (await request.json()) as { ids?: string[] };
  if (!Array.isArray(body.ids)) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  await prisma.$transaction(
    body.ids.map((id, position) =>
      prisma.project.update({ where: { id }, data: { position } })
    )
  );
  revalidateTag("sidebar-projects", "max");
  return NextResponse.json({ ok: true });
}
