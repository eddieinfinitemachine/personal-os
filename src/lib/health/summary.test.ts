import { describe, expect, it } from "vitest";
import { alignDecimals, labDate, labRange, labShown, labStatus } from "./lab-value";
import type { WorkoutRecord } from "@/lib/workout-history";
import { buildHealthSummary, healthFingerprints, type HealthSummaryInput } from "./summary";

const now = new Date("2030-06-15T12:00:00Z");

const lab = (marker: string, date: string, value: number, extra: Partial<HealthSummaryInput["labs"][number]> = {}) => ({
  panel: "Lipids",
  marker,
  drawnAt: new Date(`${date}T00:00:00Z`),
  value,
  unit: "mg/dL",
  refLow: null,
  refHigh: 100,
  flag: null,
  notes: null,
  ...extra,
});

const input = (overrides: Partial<HealthSummaryInput> = {}): HealthSummaryInput => ({
  sex: "M",
  birthDate: new Date("1990-07-01T00:00:00Z"),
  notes: null,
  medications: null,
  conditions: null,
  allergies: null,
  labs: [],
  visits: [],
  fitness: [],
  dna: [],
  biometrics: [],
  biometricReadings: 0,
  workouts: [],
  recoveryReadings: [],
  nutrition: [],
  ...overrides,
});

const workout = (id: string, date: string, load = "25 lb"): WorkoutRecord => ({
  id,
  source: "guided",
  title: "Lower day",
  focus: "lower",
  startedAt: new Date(`${date}T11:20:00Z`).getTime(),
  finishedAt: new Date(`${date}T12:00:00Z`).getTime(),
  durationMin: 40,
  exercises: [{ name: "Goblet squat", equipment: "dumbbell", targetReps: 10, sets: [{ reps: 10, durationSec: null, load }] }],
});

const food = (date: string, extra: Partial<HealthSummaryInput["nutrition"][number]> = {}): HealthSummaryInput["nutrition"][number] => ({
  date,
  caloriesKcal: 2000,
  proteinG: 140,
  carbsG: 200,
  fatG: 70,
  saturatedFatG: 20,
  fiberG: 30,
  sugarG: 45,
  sodiumMg: 2200,
  app: "Food App",
  ...extra,
});

// HRV readings ending on `latestDate`, with three earlier days for a baseline.
const hrv = (latestDate: string, latest: number) => [
  { kind: "hrv", value: latest, unit: "ms", measuredAt: new Date(`${latestDate}T07:00:00Z`) },
  ...[1, 2, 3].map((d) => ({ kind: "hrv", value: 60, unit: "ms", measuredAt: new Date(new Date(`${latestDate}T07:00:00Z`).getTime() - d * 86_400_000) })),
];

describe("lab values", () => {
  it("shows a reporting limit as the report did", () => {
    expect(labShown({ value: 2, notes: "<2" })).toBe("<2");
    expect(labShown({ value: 2.5, notes: null })).toBe("2.5");
    expect(labShown({ value: 2.5, notes: "fasting" })).toBe("2.5");
  });

  it("doesn't call a limit above the range high", () => {
    expect(labStatus({ value: 2, notes: "<2", refLow: null, refHigh: 1 })).toBe("unknown");
    expect(labStatus({ value: 2, notes: "<2", refLow: null, refHigh: 2 })).toBe("normal");
    expect(labStatus({ value: 2, notes: null, refLow: null, refHigh: 1 })).toBe("high");
  });

  it("formats ranges", () => {
    expect(labRange({ refLow: 1, refHigh: 2 })).toBe("1–2");
    expect(labRange({ refLow: 1, refHigh: null })).toBe(">1");
    expect(labRange({ refLow: null, refHigh: 2 })).toBe("<2");
    expect(labRange({ refLow: null, refHigh: null })).toBeNull();
  });

  it("pads a marker's results to the same decimals and leaves limits alone", () => {
    expect(alignDecimals(["5.2", "5", "5.1"])).toEqual(["5.2", "5.0", "5.1"]);
    expect(alignDecimals(["87", "97"])).toEqual(["87", "97"]);
    expect(alignDecimals(["<2", "1.5", "3"])).toEqual(["<2", "1.5", "3.0"]);
    expect(alignDecimals(["<2"])).toEqual(["<2"]);
  });

  it("formats a draw date in UTC, so midnight doesn't slip a day", () => {
    expect(labDate("2030-01-10")).toBe("Jan 10, 2030");
    expect(labDate("2030-01-10T00:00:00.000Z")).toBe("Jan 10, 2030");
  });
});

describe("buildHealthSummary", () => {
  it("builds each marker's history oldest first, with the latest change", () => {
    const summary = buildHealthSummary(
      input({ labs: [lab("Marker A", "2029-06-01", 120), lab("Marker A", "2028-01-01", 100), lab("Marker B", "2029-06-01", 50)] }),
      now,
    );
    const a = summary.labs.markers.find((m) => m.marker === "Marker A")!;
    expect(a.points.map((p) => p.date)).toEqual(["2028-01-01", "2029-06-01"]);
    expect(a.change).toBe(20);
    expect(a.changePct).toBe(20);
    expect(summary.labs.markers.find((m) => m.marker === "Marker B")!.change).toBeNull();
    expect(summary.labs.draws).toEqual(["2028-01-01", "2029-06-01"]);
    expect(summary.labs.latestDraw).toBe("2029-06-01");
    expect(summary.labs.monthsSinceLatestDraw).toBe(12);
  });

  it("reports no change when either side is a reporting limit", () => {
    const summary = buildHealthSummary(
      input({ labs: [lab("Marker C", "2028-01-01", 1, { notes: "<1" }), lab("Marker C", "2029-01-01", 2, { notes: "<2" })] }),
      now,
    );
    const marker = summary.labs.markers[0];
    expect(marker.change).toBeNull();
    expect(marker.points.map((p) => p.shown)).toEqual(["<1", "<2"]);
  });

  it("keeps the last range on record when the latest lab reports none, and that lab's own flag", () => {
    const summary = buildHealthSummary(
      input({
        labs: [
          lab("Marker D", "2028-01-01", 90, { refHigh: 100 }),
          lab("Marker D", "2029-01-01", 95, { refLow: 10, refHigh: 110 }),
          lab("Marker D", "2030-01-01", 96, { refHigh: null, flag: "high" }),
        ],
      }),
      now,
    );
    const marker = summary.labs.markers[0];
    expect([marker.refLow, marker.refHigh]).toEqual([10, 110]);
    expect(marker.points.map((p) => p.status)).toEqual(["normal", "normal", "high"]);
  });

  it("reports no range for a marker that never had one", () => {
    const summary = buildHealthSummary(input({ labs: [lab("Marker E", "2030-01-01", 5, { refHigh: null })] }), now);
    expect([summary.labs.markers[0].refLow, summary.labs.markers[0].refHigh]).toEqual([null, null]);
  });

  it("includes each biometric's latest value and date, sorted by kind", () => {
    const summary = buildHealthSummary(
      input({
        biometrics: [
          { kind: "weight", measuredAt: new Date("2030-06-01T00:00:00Z"), value: 170, unit: "lb" },
          { kind: "bpSystolic", measuredAt: new Date("2030-05-01T00:00:00Z"), value: 118, unit: "mmHg" },
        ],
        biometricReadings: 40,
      }),
      now,
    );
    expect(summary.biometrics).toEqual([
      { kind: "bpSystolic", date: "2030-05-01", value: 118, unit: "mmHg" },
      { kind: "weight", date: "2030-06-01", value: 170, unit: "lb" },
    ]);
    expect(summary.coverage.biometricReadings).toBe(40);
  });

  it("leaves out identity and provider details", () => {
    const summary = buildHealthSummary(
      input({ medications: [{ name: "Supplement A", dosage: "1 mg", prescribedBy: "Dr. Example", since: "2029-01" }] }),
      now,
    );
    expect(summary.medications).toEqual([{ name: "Supplement A", dosage: "1 mg", since: "2029-01" }]);
    expect(JSON.stringify(summary)).not.toContain("Dr. Example");
    expect(JSON.stringify(summary)).not.toContain("1990");
    expect(summary.person.age).toBe(39);
  });

  it("knows when medication start dates are missing", () => {
    const missing = buildHealthSummary(input({ medications: [{ name: "A" }, { name: "B", since: "2029" }] }), now);
    expect(missing.coverage.medicationStartDatesKnown).toBe(false);
    const known = buildHealthSummary(input({ medications: [{ name: "B", since: "2029" }] }), now);
    expect(known.coverage.medicationStartDatesKnown).toBe(true);
  });

  it("counts recent activity only", () => {
    const summary = buildHealthSummary(
      input({
        fitness: [
          { performedAt: new Date("2030-06-01T00:00:00Z"), kind: "run", durationMin: 30 },
          { performedAt: new Date("2030-06-10T00:00:00Z"), kind: "lift", durationMin: 45 },
          { performedAt: new Date("2029-01-01T00:00:00Z"), kind: "run", durationMin: 30 },
        ],
      }),
      now,
    );
    expect(summary.activity.sessionsInWindow).toBe(2);
    expect(summary.activity.byKind).toEqual({ run: 1, lift: 1 });
    expect(summary.activity.lastSession).toBe("2030-06-10");
  });
});

describe("training and recovery", () => {
  it("summarizes the workout log", () => {
    const summary = buildHealthSummary(input({ workouts: [workout("w-1", "2030-06-01"), workout("w-2", "2030-06-10", "30 lb")] }), now);
    expect(summary.training.sessions).toBe(2);
    expect(summary.training.lastSession).toMatchObject({ date: "2030-06-10", title: "Lower day" });
    expect(summary.training.lifts[0]).toMatchObject({ name: "Goblet squat", times: 2, next: "35 lb", loadChange: { from: 25, to: 30, unit: "lb" } });
  });

  it("reads recovery the way the Workout tab does", () => {
    const low = buildHealthSummary(input({ recoveryReadings: hrv("2030-06-15", 40) }), now);
    expect(low.recovery.readiness).toBe("low");
    expect(low.recovery.note).toContain("HRV 40 ms");
    expect(low.recovery.hrv).toEqual({ latest: { date: "2030-06-15", value: 40, unit: "ms" }, baseline: 60 });
    expect(low.recovery.rhr).toBeNull();

    const normal = buildHealthSummary(input({ recoveryReadings: hrv("2030-06-15", 58) }), now);
    expect(normal.recovery.readiness).toBe("normal");
  });

  it("has no readiness without a recent reading, but keeps the last trend", () => {
    const summary = buildHealthSummary(input({ recoveryReadings: hrv("2030-06-05", 40) }), now);
    expect(summary.recovery).toMatchObject({ readiness: null, note: null });
    expect(summary.recovery.hrv?.latest.date).toBe("2030-06-05");
  });

  it("is empty without workouts or readings", () => {
    const summary = buildHealthSummary(input(), now);
    expect(summary.training.sessions).toBe(0);
    expect(summary.recovery).toEqual({ readiness: null, note: null, hrv: null, rhr: null });
  });
});

describe("nutrition", () => {
  it("summarizes the diet, with protein per pound of the latest weight", () => {
    const weight = (date: string, value: number, unit = "lb") => ({ kind: "weight", measuredAt: new Date(`${date}T08:00:00Z`), value, unit });
    const summary = buildHealthSummary(
      input({ nutrition: [food("2030-06-14"), food("2030-06-13", { proteinG: 160 })], biometrics: [weight("2030-06-10", 180)] }),
      now,
    );
    expect(summary.nutrition).toMatchObject({ daysLogged: 2, app: "Food App", latestDay: "2030-06-14" });
    expect(summary.nutrition.averages.last7).toMatchObject({ days: 2, proteinG: 150, proteinGPerLb: 0.83 });

    const kg = buildHealthSummary(input({ nutrition: [food("2030-06-14")], biometrics: [weight("2030-06-10", 70, "kg")] }), now);
    expect(kg.nutrition.averages.last7.proteinGPerLb).toBe(0.91);
    const other = buildHealthSummary(input({ nutrition: [food("2030-06-14")], biometrics: [weight("2030-06-10", 11, "st")] }), now);
    expect(other.nutrition.averages.last7.proteinGPerLb).toBeNull();
  });

  it("is empty without logged days", () => {
    const summary = buildHealthSummary(input(), now);
    expect(summary.nutrition).toMatchObject({ windowDays: 28, daysLogged: 0, app: null, latestDay: null, recent: [] });
    expect(summary.nutrition.averages.last28.days).toBe(0);
  });
});

describe("healthFingerprints", () => {
  const labs = [lab("Marker A", "2029-06-01", 90)];

  it("doesn't change just because time passed", () => {
    const earlier = healthFingerprints(buildHealthSummary(input({ labs }), now));
    const later = healthFingerprints(buildHealthSummary(input({ labs }), new Date("2031-02-01T00:00:00Z")));
    expect(later.core).toBe(earlier.core);
  });

  it("changes core when labs or notes change", () => {
    const base = healthFingerprints(buildHealthSummary(input({ labs }), now));
    const newLab = healthFingerprints(buildHealthSummary(input({ labs: [...labs, lab("Marker B", "2030-01-01", 5)] }), now));
    const newNote = healthFingerprints(buildHealthSummary(input({ labs, notes: "New goal" }), now));
    expect(newLab.core).not.toBe(base.core);
    expect(newNote.core).not.toBe(base.core);
  });

  it("keeps activity out of core", () => {
    const base = healthFingerprints(buildHealthSummary(input({ labs }), now));
    const withWorkout = healthFingerprints(
      buildHealthSummary(input({ labs, fitness: [{ performedAt: new Date("2030-06-10T00:00:00Z"), kind: "run", durationMin: 30 }] }), now),
    );
    expect(withWorkout.core).toBe(base.core);
    expect(withWorkout.activity).not.toBe(base.activity);
  });

  it("changes activity, not core, when a workout is logged", () => {
    const base = healthFingerprints(buildHealthSummary(input({ labs, workouts: [workout("w-1", "2030-06-01")] }), now));
    const more = healthFingerprints(
      buildHealthSummary(input({ labs, workouts: [workout("w-1", "2030-06-01"), workout("w-2", "2030-06-10")] }), now),
    );
    expect(more.core).toBe(base.core);
    expect(more.activity).not.toBe(base.activity);
  });

  it("changes activity, not core, when the latest HRV changes", () => {
    const base = healthFingerprints(buildHealthSummary(input({ labs, recoveryReadings: hrv("2030-06-15", 58) }), now));
    const moved = healthFingerprints(buildHealthSummary(input({ labs, recoveryReadings: hrv("2030-06-15", 40) }), now));
    expect(moved.core).toBe(base.core);
    expect(moved.activity).not.toBe(base.activity);
  });

  it("changes activity, not core, when a logged day changes", () => {
    const base = healthFingerprints(buildHealthSummary(input({ labs, nutrition: [food("2030-06-14")] }), now));
    const edited = healthFingerprints(buildHealthSummary(input({ labs, nutrition: [food("2030-06-14", { caloriesKcal: 2400 })] }), now));
    const more = healthFingerprints(buildHealthSummary(input({ labs, nutrition: [food("2030-06-14"), food("2030-06-13")] }), now));
    // Fields and days `recent` leaves out still count.
    const sodium = healthFingerprints(buildHealthSummary(input({ labs, nutrition: [food("2030-06-14", { sodiumMg: 3100 })] }), now));
    for (const changed of [edited, more, sodium]) {
      expect(changed.core).toBe(base.core);
      expect(changed.activity).not.toBe(base.activity);
    }
  });

  it("keeps nutrition steady when only the date moves", () => {
    // Out of the 7-day average but still inside the 28-day window.
    const records = input({ labs, nutrition: [food("2030-06-10"), food("2030-06-01", { proteinG: 100 })] });
    const earlier = buildHealthSummary(records, new Date("2030-06-11T12:00:00Z"));
    const later = buildHealthSummary(records, new Date("2030-06-20T12:00:00Z"));
    expect(earlier.nutrition.averages.last7).not.toEqual(later.nutrition.averages.last7);
    expect(healthFingerprints(later)).toEqual(healthFingerprints(earlier));
  });

  it("keeps activity steady when only the date moves", () => {
    // Across a week boundary and past the 2 days a recovery reading counts for.
    const records = input({ labs, workouts: [workout("w-1", "2030-06-01"), workout("w-2", "2030-06-10")], recoveryReadings: hrv("2030-06-10", 40) });
    const earlier = buildHealthSummary(records, new Date("2030-06-10T13:00:00Z"));
    const later = buildHealthSummary(records, new Date("2030-06-17T12:00:00Z"));
    expect(earlier.training.weeks[0].weekStart).not.toBe(later.training.weeks[0].weekStart);
    expect(earlier.recovery.readiness).not.toBe(later.recovery.readiness);
    expect(healthFingerprints(later)).toEqual(healthFingerprints(earlier));
  });

  it("keeps biometric readings out of core", () => {
    const base = healthFingerprints(buildHealthSummary(input({ labs }), now));
    const withReading = healthFingerprints(
      buildHealthSummary(
        input({ labs, biometrics: [{ kind: "rhr", measuredAt: new Date("2030-06-10T00:00:00Z"), value: 60, unit: "bpm" }] }),
        now,
      ),
    );
    expect(withReading.core).toBe(base.core);
    expect(withReading.activity).not.toBe(base.activity);
  });
});
