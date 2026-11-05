import { prisma } from "@/lib/prisma";
import { normalizeRecords, type WorkoutRecord } from "@/lib/workout-history";
import { RECOVERY_WINDOW_DAYS } from "@/lib/workout-readiness";
import { NUTRITION_WINDOW_DAYS, type NutritionDayRow } from "./nutrition";
import { ACTIVITY_WINDOW_DAYS, buildHealthSummary, type HealthSummary } from "./summary";
import { TRAINING_WINDOW_DAYS } from "./training";

const DAY = 86_400_000;
const MAX_WORKOUTS = 60;
const MAX_NUTRITION_DAYS = 60;

type HumanForSummary = {
  id: string;
  userId: string;
  sex: string | null;
  birthDate: Date | null;
  notes: string | null;
  medicationsJson: unknown;
  conditionsJson: unknown;
  allergiesJson: unknown;
};

/**
 * A table newer than the environment's schema may be absent (P2021): that
 * reads as no rows, and any other error still fails.
 */
async function orNone<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code === "P2021") return [];
    throw error;
  }
}

/** The Workout tab's log from the last 90 days, read the way /api/workout/history reads it. */
async function loadWorkouts(userId: string, now: Date): Promise<WorkoutRecord[]> {
  const rows = await orNone(() =>
    prisma.workoutLog.findMany({
      where: { userId, finishedAt: { gte: new Date(now.getTime() - TRAINING_WINDOW_DAYS * DAY) } },
      orderBy: { finishedAt: "desc" },
      take: MAX_WORKOUTS,
    }),
  );
  return normalizeRecords(
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
    MAX_WORKOUTS,
    now.getTime(),
  );
}

/** Days of diet the Apple Health Shortcut sent, from the last 28 days. */
async function loadNutrition(userId: string, now: Date): Promise<NutritionDayRow[]> {
  const rows = await orNone(() =>
    prisma.nutritionDay.findMany({
      where: { userId, date: { gte: new Date(now.getTime() - NUTRITION_WINDOW_DAYS * DAY) } },
      orderBy: { date: "desc" },
      take: MAX_NUTRITION_DAYS,
      select: {
        date: true,
        caloriesKcal: true,
        proteinG: true,
        carbsG: true,
        fatG: true,
        saturatedFatG: true,
        fiberG: true,
        sugarG: true,
        sodiumMg: true,
        app: true,
      },
    }),
  );
  return rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) }));
}

/** Reads everything the summary needs. Lab history is never truncated: trends depend on the oldest draw. */
export async function loadHealthSummary(human: HumanForSummary, now: Date): Promise<HealthSummary> {
  const humanId = human.id;
  const windowStart = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * DAY);
  const [labs, visits, fitness, dna, biometrics, biometricReadings, workouts, recoveryReadings, nutrition] = await Promise.all([
    prisma.labResult.findMany({
      where: { humanId },
      orderBy: { drawnAt: "asc" },
      select: {
        panel: true,
        marker: true,
        drawnAt: true,
        value: true,
        unit: true,
        refLow: true,
        refHigh: true,
        flag: true,
        notes: true,
      },
    }),
    prisma.medicalVisit.findMany({
      where: { humanId },
      orderBy: { performedAt: "desc" },
      select: { performedAt: true, specialty: true, reason: true, summary: true },
    }),
    prisma.fitnessSession.findMany({
      where: { humanId, performedAt: { gte: windowStart } },
      select: { performedAt: true, kind: true, durationMin: true },
    }),
    prisma.dnaResult.findMany({
      where: { humanId },
      orderBy: { title: "asc" },
      select: { category: true, title: true, finding: true },
    }),
    prisma.biometricReading.findMany({
      where: { humanId },
      orderBy: [{ kind: "asc" }, { measuredAt: "desc" }],
      distinct: ["kind"],
      select: { kind: true, measuredAt: true, value: true, unit: true },
    }),
    prisma.biometricReading.count({ where: { humanId } }),
    loadWorkouts(human.userId, now),
    prisma.biometricReading.findMany({
      where: {
        humanId,
        kind: { in: ["hrv", "rhr"] },
        measuredAt: { gte: new Date(now.getTime() - RECOVERY_WINDOW_DAYS * DAY) },
      },
      orderBy: { measuredAt: "desc" },
      take: 200,
      select: { kind: true, value: true, unit: true, measuredAt: true },
    }),
    loadNutrition(human.userId, now),
  ]);
  return buildHealthSummary(
    {
      sex: human.sex,
      birthDate: human.birthDate,
      notes: human.notes,
      medications: human.medicationsJson,
      conditions: human.conditionsJson,
      allergies: human.allergiesJson,
      labs,
      visits,
      fitness,
      dna,
      biometrics,
      biometricReadings,
      workouts,
      recoveryReadings,
      nutrition,
    },
    now,
  );
}
