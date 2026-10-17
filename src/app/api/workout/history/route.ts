import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { HISTORY_MAX, normalizeRecords, type WorkoutRecord } from "@/lib/workout-history";
import { syncStrava } from "@/lib/strava";

// The workout log across devices: finished guided sessions and whiteboard
// workouts set by set, plus Strava activities (pulled in here, at most every
// 30 minutes). The device keeps its own copy and works without this. The table
// may be absent on an environment whose schema is behind the code (P2021):
// that reads as an empty log and an unsaved write, so the client keeps
// retrying later.

function missingTable(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "P2021";
}

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await syncStrava(userId).catch((err) => console.error("strava sync failed", err));
  try {
    const rows = await prisma.workoutLog.findMany({
      where: { userId },
      orderBy: { finishedAt: "desc" },
      take: HISTORY_MAX,
    });
    const records = normalizeRecords(
      rows.map((r) => ({
        id: r.clientId,
        source: r.source,
        title: r.title,
        focus: r.focus,
        startedAt: r.startedAt.getTime(),
        finishedAt: r.finishedAt.getTime(),
        durationMin: r.durationMin,
        exercises: r.exercises,
        notes: r.notes,
      })),
    );
    return NextResponse.json({ records, stored: true });
  } catch (error) {
    if (missingTable(error)) return NextResponse.json({ records: [], stored: false });
    throw error;
  }
}

// { records: WorkoutRecord[] } → upsert each by the device's session id.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { records?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const records: WorkoutRecord[] = normalizeRecords(body?.records);
  if (!records.length) return NextResponse.json({ error: "no records" }, { status: 400 });
  try {
    await prisma.$transaction(
      records.map((r) => {
        const data = {
          source: r.source ?? "guided",
          title: r.title,
          focus: r.focus,
          startedAt: new Date(r.startedAt),
          finishedAt: new Date(r.finishedAt),
          durationMin: r.durationMin,
          exercises: r.exercises,
          notes: r.notes ?? null,
        };
        return prisma.workoutLog.upsert({
          where: { userId_clientId: { userId, clientId: r.id } },
          create: { userId, clientId: r.id, ...data },
          update: data,
        });
      }),
    );
    return NextResponse.json({ saved: records.map((r) => ({ id: r.id, finishedAt: r.finishedAt })), stored: true });
  } catch (error) {
    if (missingTable(error)) return NextResponse.json({ saved: [], stored: false });
    throw error;
  }
}
