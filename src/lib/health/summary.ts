import { createHash } from "node:crypto";
import type { WorkoutRecord } from "@/lib/workout-history";
import { buildSnapshot, readinessOf, trendOf, type Readiness, type Reading, type Trend } from "@/lib/workout-readiness";
import { isLimitResult, labShown, labStatus, type LabStatus } from "./lab-value";
import { summarizeNutrition, type NutritionDayRow, type NutritionSummary } from "./nutrition";
import { summarizeTraining, type TrainingSummary } from "./training";

// Plain-code summary of someone's health records: every trend, change and gap
// the picture relies on is calculated here, so the model never does arithmetic.
// Identity stays out on purpose: no name, birth date, insurer or provider names.

export const ACTIVITY_WINDOW_DAYS = 90;

export type HealthSummaryInput = {
  sex: string | null;
  birthDate: Date | null;
  notes: string | null;
  medications: unknown;
  conditions: unknown;
  allergies: unknown;
  labs: {
    panel: string;
    marker: string;
    drawnAt: Date;
    value: number;
    unit: string;
    refLow: number | null;
    refHigh: number | null;
    flag: string | null;
    notes: string | null;
  }[];
  visits: { performedAt: Date; specialty: string | null; reason: string; summary: string | null }[];
  fitness: { performedAt: Date; kind: string; durationMin: number | null }[];
  dna: { category: string; title: string; finding: string }[];
  /** The latest reading of each kind. */
  biometrics: { kind: string; measuredAt: Date; value: number; unit: string }[];
  biometricReadings: number;
  /** The Workout tab's log (WorkoutLog) from the last 90 days. */
  workouts: WorkoutRecord[];
  /** HRV and resting HR readings from the last ~33 days, for the recovery read. */
  recoveryReadings: { kind: string; value: number; unit: string; measuredAt: Date }[];
  /** Days of diet from their food app (NutritionDay) from the last 28 days. */
  nutrition: NutritionDayRow[];
};

export type MarkerPoint = { date: string; value: number; shown: string; status: LabStatus };

export type MarkerSummary = {
  marker: string;
  panel: string;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  points: MarkerPoint[]; // oldest first
  /** Latest minus previous. Null with one point, or when either is a reporting limit. */
  change: number | null;
  changePct: number | null;
};

/** The latest reading against the mean of the 30 days before it (null with under 3 readings). */
export type RecoveryTrend = { latest: { date: string; value: number; unit: string }; baseline: number | null };

export type RecoverySummary = {
  /** As the Workout tab reads it today: null without a reading from the last 2 days or without a baseline. */
  readiness: Readiness | null;
  note: string | null;
  hrv: RecoveryTrend | null;
  rhr: RecoveryTrend | null;
};

export type HealthSummary = {
  today: string;
  person: { age: number | null; sex: string | null };
  labs: {
    draws: string[];
    latestDraw: string | null;
    monthsSinceLatestDraw: number | null;
    markers: MarkerSummary[];
  };
  medications: Record<string, unknown>[];
  conditions: Record<string, unknown>[];
  allergies: Record<string, unknown>[];
  visits: { date: string; specialty: string | null; reason: string; summary: string | null }[];
  activity: {
    windowDays: number;
    sessionsInWindow: number;
    byKind: Record<string, number>;
    lastSession: string | null;
  };
  training: TrainingSummary;
  recovery: RecoverySummary;
  nutrition: NutritionSummary;
  dna: { category: string; title: string; finding: string }[];
  biometrics: { kind: string; date: string; value: number; unit: string }[];
  coverage: {
    biometricReadings: number;
    dnaResults: number;
    medicationStartDatesKnown: boolean;
  };
  notes: string | null;
};

export type PictureFingerprint = { core: string; activity: string };

const round = (n: number) => Math.round(n * 100) / 100;
const day = (d: Date) => d.toISOString().slice(0, 10);

function pick(value: unknown, keys: string[]): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entries = keys.flatMap((key) => {
      const v = (item as Record<string, unknown>)[key];
      return v == null || v === "" ? [] : [[key, v] as const];
    });
    return entries.length ? [Object.fromEntries(entries)] : [];
  });
}

function ageOn(now: Date, birthDate: Date | null): number | null {
  if (!birthDate) return null;
  let years = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const month = now.getUTCMonth() - birthDate.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < birthDate.getUTCDate())) years--;
  return years;
}

function monthsBetween(from: Date, to: Date): number {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months--;
  return Math.max(0, months);
}

function summarizeMarkers(labs: HealthSummaryInput["labs"]): MarkerSummary[] {
  const byMarker = new Map<string, HealthSummaryInput["labs"]>();
  for (const row of labs) {
    const rows = byMarker.get(row.marker);
    if (rows) rows.push(row);
    else byMarker.set(row.marker, [row]);
  }
  return [...byMarker.values()]
    .map((rows) => {
      const sorted = [...rows].sort((a, b) => a.drawnAt.getTime() - b.drawnAt.getTime());
      const latest = sorted[sorted.length - 1];
      const previous = sorted[sorted.length - 2];
      const comparable = previous && !isLimitResult(latest) && !isLimitResult(previous);
      // Not every lab reports a range, so a draw without one keeps the last one on record.
      const ranged = sorted.findLast((row) => row.refLow != null || row.refHigh != null);
      return {
        marker: latest.marker,
        panel: latest.panel,
        unit: latest.unit,
        refLow: ranged?.refLow ?? null,
        refHigh: ranged?.refHigh ?? null,
        points: sorted.map((row) => ({
          date: day(row.drawnAt),
          value: row.value,
          shown: labShown(row),
          status: labStatus(row),
        })),
        change: comparable ? round(latest.value - previous.value) : null,
        changePct:
          comparable && previous.value !== 0
            ? Math.round(((latest.value - previous.value) / previous.value) * 100)
            : null,
      };
    })
    .sort((a, b) => a.panel.localeCompare(b.panel) || a.marker.localeCompare(b.marker));
}

/**
 * Readiness and its note come from the Workout tab's own read (workout-readiness.ts),
 * so both tabs agree about today. The trends are taken as of each kind's latest
 * reading rather than today, so they don't change just because time passed;
 * readiness says whether that reading is recent enough to count.
 */
function summarizeRecovery(readings: HealthSummaryInput["recoveryReadings"], now: Date): RecoverySummary {
  const { readiness, note } = readinessOf(
    buildSnapshot(
      { sex: null, birthDate: null, heightInches: null, conditionsJson: null, recovery: readings, body: [], activity: [] },
      now.getTime(),
    ),
  );
  const trend = (kind: string): RecoveryTrend | null => {
    const series: Reading[] = readings
      .filter((r) => r.kind === kind)
      .map((r) => ({ value: r.value, unit: r.unit, at: r.measuredAt.getTime() }));
    if (!series.length) return null;
    const t: Trend | null = trendOf(series, Math.max(...series.map((r) => r.at)));
    return t && {
      latest: { date: day(new Date(t.latest.at)), value: t.latest.value, unit: t.latest.unit },
      baseline: t.baseline === null ? null : Math.round(t.baseline * 10) / 10,
    };
  };
  return { readiness, note, hrv: trend("hrv"), rhr: trend("rhr") };
}

const LB_PER_KG = 2.20462;

/** The latest weight in pounds, for protein per pound. Null without one in lb or kg. */
function latestWeightLb(biometrics: HealthSummaryInput["biometrics"]): number | null {
  const weight = biometrics
    .filter((b) => b.kind === "weight" && (b.unit === "lb" || b.unit === "kg"))
    .sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime())[0];
  if (!weight) return null;
  return weight.unit === "kg" ? weight.value * LB_PER_KG : weight.value;
}

export function buildHealthSummary(input: HealthSummaryInput, now: Date): HealthSummary {
  const draws = [...new Set(input.labs.map((row) => day(row.drawnAt)))].sort();
  const latestDraw = draws[draws.length - 1] ?? null;
  const medications = pick(input.medications, ["name", "dosage", "frequency", "since"]);

  const windowStart = now.getTime() - ACTIVITY_WINDOW_DAYS * 86_400_000;
  const recent = input.fitness.filter((s) => s.performedAt.getTime() >= windowStart);
  const byKind: Record<string, number> = {};
  for (const session of recent) byKind[session.kind] = (byKind[session.kind] ?? 0) + 1;
  const lastSession = recent.map((s) => day(s.performedAt)).sort().pop() ?? null;

  return {
    today: day(now),
    person: { age: ageOn(now, input.birthDate), sex: input.sex },
    labs: {
      draws,
      latestDraw,
      monthsSinceLatestDraw: latestDraw ? monthsBetween(new Date(`${latestDraw}T00:00:00Z`), now) : null,
      markers: summarizeMarkers(input.labs),
    },
    medications,
    conditions: pick(input.conditions, ["name", "diagnosedAt", "notes"]),
    allergies: pick(input.allergies, ["allergen", "severity", "notes"]),
    visits: input.visits.map((v) => ({
      date: day(v.performedAt),
      specialty: v.specialty,
      reason: v.reason,
      summary: v.summary,
    })),
    activity: {
      windowDays: ACTIVITY_WINDOW_DAYS,
      sessionsInWindow: recent.length,
      byKind,
      lastSession,
    },
    training: summarizeTraining(input.workouts, now),
    recovery: summarizeRecovery(input.recoveryReadings, now),
    nutrition: summarizeNutrition(input.nutrition, latestWeightLb(input.biometrics), now),
    dna: input.dna,
    biometrics: input.biometrics
      .map((b) => ({ kind: b.kind, date: day(b.measuredAt), value: b.value, unit: b.unit }))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
    coverage: {
      biometricReadings: input.biometricReadings,
      dnaResults: input.dna.length,
      medicationStartDatesKnown: medications.length > 0 && medications.every((m) => m.since != null),
    },
    notes: input.notes?.trim() || null,
  };
}

/** The training summary without `weeks` and `sessionsPerWeek`, which move with the calendar alone. */
function trainingLog(t: TrainingSummary) {
  return [t.sessions, t.minutes, t.bySource, t.byFocus, t.lastSession, t.recent, t.lifts, t.cardio];
}

/**
 * The logged days behind the nutrition summary. The 28-day averages span the
 * same days as `daysLogged`, so they only move when a day is logged, changed
 * or ages out, and they cover the older days and the fields `recent` leaves
 * out. The 7- and 14-day averages move with the calendar alone.
 */
function nutritionLog(n: NutritionSummary) {
  return [n.daysLogged, n.app, n.recent, n.averages.last28];
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * What the picture was written from. `core` covers records that change the
 * reading (labs, notes, medications, visits, DNA). `activity` moves often, so a
 * change there alone refreshes the picture less eagerly. Neither depends on
 * today's date, or the picture would rewrite itself every day: training's weekly
 * buckets and rate move with the calendar, recovery's readiness with the age of
 * the latest reading, and nutrition's 7- and 14-day averages with the
 * calendar too, so those stay out and the log, readings and logged days behind
 * them go in.
 */
export function healthFingerprints(summary: HealthSummary): PictureFingerprint {
  return {
    core: hash({
      sex: summary.person.sex,
      markers: summary.labs.markers.map((m) => [m.marker, m.unit, m.refLow, m.refHigh, m.points.map((p) => [p.date, p.shown])]),
      medications: summary.medications,
      conditions: summary.conditions,
      allergies: summary.allergies,
      visits: summary.visits,
      dna: summary.dna,
      notes: summary.notes,
    }),
    activity: hash({
      activity: summary.activity,
      biometrics: summary.biometrics,
      training: trainingLog(summary.training),
      recovery: [summary.recovery.hrv, summary.recovery.rhr],
      nutrition: nutritionLog(summary.nutrition),
    }),
  };
}
