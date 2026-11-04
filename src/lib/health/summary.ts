import { createHash } from "node:crypto";
import { isLimitResult, labShown, labStatus, type LabStatus } from "./lab-value";

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
  biometricReadings: number;
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
  dna: { category: string; title: string; finding: string }[];
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
      return {
        marker: latest.marker,
        panel: latest.panel,
        unit: latest.unit,
        refLow: latest.refLow,
        refHigh: latest.refHigh,
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
    dna: input.dna,
    coverage: {
      biometricReadings: input.biometricReadings,
      dnaResults: input.dna.length,
      medicationStartDatesKnown: medications.length > 0 && medications.every((m) => m.since != null),
    },
    notes: input.notes?.trim() || null,
  };
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * What the picture was written from. `core` covers records that change the
 * reading (labs, notes, medications, visits, DNA). `activity` moves often, so a
 * change there alone refreshes the picture less eagerly. Neither depends on
 * today's date, or the picture would rewrite itself every day.
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
    activity: hash({ activity: summary.activity, biometricReadings: summary.coverage.biometricReadings }),
  };
}
