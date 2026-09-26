import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Timestamps and direction only (no text) for the chart and stats.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const rows = await prisma.datingMessage.findMany({
    where: { userId, personId: id },
    orderBy: { sentAt: "asc" },
    select: { sentAt: true, fromMe: true },
  });
  return NextResponse.json({ meta: rows.map((r) => ({ sentAt: r.sentAt.toISOString(), fromMe: r.fromMe })) });
}
