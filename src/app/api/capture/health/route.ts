import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { IntakeError, readJSON } from "@/lib/dating-intake/contracts";
import { CAPTURE_LIMITS, CaptureError, parseHealthCapture, utcDayBounds, type HealthCapture } from "@/lib/health/capture";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const SOURCE = "apple-health";

// Health data is written to NutritionDay and BiometricReading only; never logged.
function failure(error: unknown) {
  if (error instanceof IntakeError || error instanceof CaptureError)
    return NextResponse.json({ error: error.message }, { status: error.status, headers });
  console.error("health capture failed");
  return NextResponse.json({ error: "Could not save health data; try again" }, { status: 500, headers });
}

function missingTable(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "P2021";
}

function dayWrites(userId: string, { app, days }: HealthCapture) {
  return days.map(({ date, ...values }) => {
    const data = { ...values, ...(app ? { app } : {}) };
    const day = new Date(`${date}T00:00:00Z`);
    return prisma.nutritionDay.upsert({
      where: { userId_date: { userId, date: day } },
      create: { userId, date: day, source: SOURCE, ...data },
      update: data,
    });
  });
}

/** One reading per kind per UTC day from Apple Health: the day's earlier row goes, the new one goes in. */
function readingWrites(userId: string, humanId: string, { readings }: HealthCapture) {
  return readings.flatMap(({ kind, value, unit, at }) => [
    prisma.biometricReading.deleteMany({ where: { humanId, kind, source: SOURCE, measuredAt: utcDayBounds(at) } }),
    prisma.biometricReading.create({
      data: { userId, humanId, measuredAt: new Date(at), kind, value, unit, source: SOURCE },
    }),
  ]);
}

/**
 * The Apple Health Shortcut's daily send (docs/shortcuts/apple-health.md):
 * days of diet from the food app → NutritionDay, vitals → BiometricReading on
 * the user's own Human. POST only: a GET from the Shortcut's default Method
 * answers 405 instead of looking saved.
 */
export async function POST(request: Request) {
  try {
    const userId = (await getCurrentUserId(request)) ?? (await resolveCaptureUser(request));
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    const capture = parseHealthCapture(await readJSON(request, CAPTURE_LIMITS.maxBodyBytes));
    if (!capture.days.length && !capture.readings.length)
      throw new CaptureError("Nothing to save: no diet values or readings found in the body");

    const human = capture.readings.length
      ? await prisma.human.findFirst({
          where: { project: { userId, archived: false } },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        })
      : null;
    const readingsFor = () => (human ? readingWrites(userId, human.id, capture) : []);
    const readings = human ? capture.readings.length : 0;
    const extra = capture.readings.length && !human ? { reason: "no-human" } : {};

    // One transaction: a send lands whole or not at all. The NutritionDay
    // table may be absent where the schema is behind the code (P2021): the
    // readings are still saved, and stored: false says the days weren't.
    try {
      const writes = [...dayWrites(userId, capture), ...readingsFor()];
      if (writes.length) await prisma.$transaction(writes);
    } catch (error) {
      if (!missingTable(error) || !capture.days.length) throw error;
      const writes = readingsFor();
      if (writes.length) await prisma.$transaction(writes);
      return NextResponse.json({ days: 0, readings, stored: false, ...extra }, { headers });
    }
    return NextResponse.json({ days: capture.days.length, readings, stored: true, ...extra }, { headers });
  } catch (error) {
    return failure(error);
  }
}
