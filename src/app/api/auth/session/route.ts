import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

// "Who am I?" for the native app (bearer) and the web (cookie). /api/auth is
// a public prefix, but the middleware still forwards x-user-id whenever the
// cookie or bearer session is valid.
export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId(req);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    : null;
  if (!userId || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ userId, email: user.email });
}
