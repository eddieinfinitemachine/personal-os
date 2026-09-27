import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { refreshDatingInsights } from "@/lib/dating-insights";
import { toPersonDTO } from "@/lib/dating-server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const { id } = await params;
  const person = await prisma.datingPerson.findFirst({
    where: { id, userId }, select: { insights: true, insightsAt: true },
  });
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404, headers });
  return NextResponse.json(person, { headers });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    // A deliberate in-app refresh still runs even when imports are unchanged.
    const result = await refreshDatingInsights(userId, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ person: toPersonDTO(result.person), sources: result.sources });
  } catch {
    console.error("dating insights refresh failed");
    return NextResponse.json({ error: "Could not refresh this summary; try again" }, { status: 502 });
  }
}
