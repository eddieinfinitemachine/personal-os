import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { deauthorizeStrava, isStravaConfigured } from "@/lib/strava";

// Strava connection status for the workout page, and disconnecting. Activities
// already pulled into the workout log stay there.

function missingTable(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "P2021";
}

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isStravaConfigured()) return NextResponse.json({ configured: false, connected: false });
  try {
    const conn = await prisma.stravaConnection.findUnique({ where: { userId }, select: { athleteName: true, lastSyncAt: true } });
    return NextResponse.json({
      configured: true,
      connected: !!conn,
      athleteName: conn?.athleteName ?? null,
      lastSyncAt: conn?.lastSyncAt?.getTime() ?? null,
    });
  } catch (error) {
    if (missingTable(error)) return NextResponse.json({ configured: true, connected: false });
    throw error;
  }
}

export async function DELETE(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const conn = await prisma.stravaConnection.findUnique({ where: { userId } });
  if (conn) {
    await deauthorizeStrava(conn).catch((err) => console.error("strava deauthorize failed", err));
    await prisma.stravaConnection.delete({ where: { userId } });
  }
  return NextResponse.json({ connected: false });
}
