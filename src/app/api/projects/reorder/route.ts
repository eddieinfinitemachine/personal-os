import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as { ids?: string[] };
  if (!Array.isArray(body.ids)) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (body.ids.length > 0) {
    const cases = body.ids.map(
      (id, position) => Prisma.sql`WHEN ${id} THEN ${position}`,
    );
    await prisma.$executeRaw`
      UPDATE "Project"
      SET "position" = CASE "id" ${Prisma.join(cases, " ")} END
      WHERE "userId" = ${userId} AND "id" IN (${Prisma.join(body.ids)})
    `;
  }
  revalidateTag(`sidebar-projects:${userId}`, "max");
  return NextResponse.json({ ok: true });
}
