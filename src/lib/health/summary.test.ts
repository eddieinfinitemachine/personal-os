import { describe, expect, it } from "vitest";
import { alignDecimals, labDate, labRange, labShown, labStatus } from "./lab-value";
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
  ...overrides,
});

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
