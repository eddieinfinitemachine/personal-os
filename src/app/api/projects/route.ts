import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { projectSummarySelect, toProjectSummary } from "@/lib/project-detail";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

/**
 * The caller's Project rows (generic, vehicle, pet, human), in the order
 * /vehicles and /pets use. Archived projects only with `?archived=1`.
 */
export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });

  const includeArchived = new URL(request.url).searchParams.get("archived") === "1";
  const rows = await prisma.project.findMany({
    where: includeArchived ? { userId } : { userId, archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: projectSummarySelect,
  });
  return NextResponse.json({ projects: rows.map(toProjectSummary) }, { headers });
}
