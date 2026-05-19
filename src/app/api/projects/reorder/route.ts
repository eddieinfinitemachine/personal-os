import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as { ids?: string[] };
  if (!Array.isArray(body.ids)) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  await prisma.$transaction(
    body.ids.map((id, position) =>
      prisma.project.updateMany({ where: { id, userId }, data: { position } })
    )
  );
  revalidateTag("sidebar-projects", "max");
  return NextResponse.json({ ok: true });
}
