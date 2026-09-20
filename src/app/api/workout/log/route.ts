import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// Log a finished guided workout as a FitnessSession on the user's own Human
// record (the Personal / health dashboard). Data-only write, no schema change.
// If the user has no Human yet the session stays in localStorage history only.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    title?: unknown;
    startedAt?: unknown;
    durationMin?: unknown;
    notes?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const startedAt = typeof body.startedAt === "number" ? new Date(body.startedAt) : new Date();
  const durationMin =
    typeof body.durationMin === "number" && Number.isFinite(body.durationMin)
      ? Math.max(1, Math.min(600, Math.round(body.durationMin)))
      : null;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 4000) : "";

  const human = await prisma.human.findFirst({
    where: { project: { userId, archived: false } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!human) return NextResponse.json({ logged: false, reason: "no-human" });

  const session = await prisma.fitnessSession.create({
    data: {
      humanId: human.id,
      userId,
      performedAt: startedAt,
      kind: "lift",
      durationMin,
      notes: [title, notes].filter(Boolean).join("\n"),
      source: "manual",
    },
    select: { id: true },
  });
  return NextResponse.json({ logged: true, id: session.id });
}
