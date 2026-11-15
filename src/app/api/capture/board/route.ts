import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { parseBoardRead, tagCounts, toBoardReference } from "@/lib/board-read";

export const dynamic = "force-dynamic";

// The board's pictures for a tool that holds the capture token: read-only,
// picture items only, a few fields each. `?tag=`, `?kind=` and `?q=` narrow
// it; `tags` always counts the whole board so a picker can list them; `taste`
// is the profile Claude wrote from the board, when there is one.
export async function GET(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const query = parseBoardRead(new URL(request.url).searchParams);
  const [rows, all, taste] = await Promise.all([
    prisma.boardItem.findMany({
      where: {
        userId,
        imageUrl: { not: null },
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.tag ? { tags: { has: query.tag } } : {}),
        ...(query.q
          ? { OR: [{ title: { contains: query.q, mode: "insensitive" as const } }, { note: { contains: query.q, mode: "insensitive" as const } }, { siteName: { contains: query.q, mode: "insensitive" as const } }] }
          : {}),
      },
      orderBy: { savedAt: "desc" },
      take: query.limit,
    }),
    prisma.boardItem.findMany({ where: { userId, imageUrl: { not: null } }, select: { tags: true } }),
    prisma.boardTaste.findUnique({ where: { userId }, select: { profile: true } }),
  ]);
  return NextResponse.json({
    items: rows.map(toBoardReference).filter((item) => item !== null),
    tags: tagCounts(all),
    taste: taste?.profile ?? null,
  });
}
