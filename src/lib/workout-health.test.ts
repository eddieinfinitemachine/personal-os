import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ human: vi.fn(), readings: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { human: { findFirst: mocks.human }, biometricReading: { findMany: mocks.readings } } }));
import {
  buildSnapshot,
  healthPrompt,
  healthSummary,
  loadHealth,
  readinessOf,
  trendOf,
  type HealthSnapshot,
  type Reading,
} from "./workout-health";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 17, 12);
const r = (value: number, daysAgo: number, unit = "ms"): Reading => ({ value, unit, at: NOW - daysAgo * DAY });
const empty: HealthSnapshot = { age: null, sex: null, heightIn: null, weight: null, bodyFat: null, vo2: null, hrv: null, rhr: null, conditions: [], activity: [] };

describe("trendOf", () => {
  it("compares a reading from the last 2 days with the 30 days before it", () => {
    expect(trendOf([r(50, 10), r(42, 0.2), r(60, 5), r(55, 20), r(99, 40)], NOW)).toEqual({ latest: r(42, 0.2), baseline: 55 });
    expect(trendOf([r(42, 0), r(50, 3)], NOW)).toEqual({ latest: r(42, 0), baseline: null });
    expect(trendOf([r(42, 3), r(50, 4), r(50, 5), r(50, 6)], NOW)).toBeNull();
    expect(trendOf([], NOW)).toBeNull();
  });
});

describe("readinessOf", () => {
  it("reads low from HRV 15% under its average or resting HR 5 bpm over, normal otherwise", () => {
    expect(readinessOf({ ...empty, hrv: { latest: r(42, 0), baseline: 55 } })).toEqual({
      readiness: "low", note: "HRV 42 ms is 24% under your 30-day average (55).",
    });
    expect(readinessOf({ ...empty, hrv: { latest: r(50, 0), baseline: 55 }, rhr: { latest: r(58, 0, "bpm"), baseline: 52.4 } })).toEqual({
      readiness: "low", note: "Resting HR 58 is 6 bpm over your 30-day average (52).",
    });
    expect(readinessOf({ ...empty, hrv: { latest: r(50, 0), baseline: 55 }, rhr: { latest: r(54, 0, "bpm"), baseline: 52 } })).toEqual({
      readiness: "normal", note: "HRV and resting HR are in your normal range.",
    });
    expect(readinessOf({ ...empty, hrv: { latest: r(50, 0), baseline: null } })).toEqual({ readiness: null, note: null });
  });
});

describe("healthPrompt and healthSummary", () => {
  const full: HealthSnapshot = {
    age: 41,
    sex: "M",
    heightIn: 71,
    weight: r(182, 2, "lb"),
    bodyFat: r(18.5, 17, "%"),
    vo2: r(45, 30, "ml/kg/min"),
    hrv: { latest: r(42, 0), baseline: 55 },
    rhr: { latest: r(53, 0, "bpm"), baseline: 52 },
    conditions: ["Lower back strain (no heavy spinal flexion)", "Tennis elbow"],
    activity: [{ kind: "run", at: NOW - DAY, durationMin: 52, distanceMi: 6.2 }, { kind: "yoga", at: NOW - 2 * DAY, durationMin: 30, distanceMi: null }],
  };
  it("gives the planner the profile, recovery, conditions and other training", () => {
    expect(healthPrompt(full, NOW)).toBe(
      [
        "Athlete health data, from their health profile:",
        `- 41-year-old male 5'11", 182 lb (2026-10-15), body fat 18.5% (2026-09-30), VO2 max 45 (2026-09-17)`,
        "- Recovery today is LOW: HRV 42 ms is 24% under your 30-day average (55). Keep loads at or below last time, drop a set from the main lifts and keep effort moderate.",
        "- Conditions to work around: Lower back strain (no heavy spinal flexion); Tennis elbow.",
        "- Other training in the last 3 days: run, 6.2 mi, 52 min (yesterday); yoga, 30 min (2 days ago).",
      ].join("\n"),
    );
    expect(healthPrompt({ ...empty, hrv: { latest: r(54, 0), baseline: 55 } }, NOW)).toBe(
      "Athlete health data, from their health profile:\n- Recovery today is normal: HRV is in your normal range. Progress loads as the log suggests.",
    );
    expect(healthPrompt(empty, NOW)).toBe("");
  });
  it("shows the facts used and the recovery read", () => {
    expect(healthSummary(full, NOW)).toEqual({
      facts: ["182 lb", "18.5% body fat", "HRV 42 ms · avg 55", "Resting HR 53 · avg 52", "Run yesterday", "Yoga 2 days ago", "2 conditions noted"],
      readiness: "low",
      note: "HRV 42 ms is 24% under your 30-day average (55).",
    });
    expect(healthSummary(empty, NOW)).toEqual({ facts: [], readiness: null, note: null });
  });
});

describe("loading the profile", () => {
  const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY);
  beforeEach(() => vi.clearAllMocks());
  it("reads the user's first health profile: recent HRV/resting HR, latest body readings, other training", async () => {
    mocks.human.mockResolvedValue({
      id: "h1",
      sex: "F",
      birthDate: new Date(Date.UTC(1990, 9, 18)),
      heightInches: 66,
      conditionsJson: [{ name: " Knee pain ", notes: "left" }, { name: "" }, "x", { name: "Asthma" }],
      biometrics: [
        { kind: "hrv", value: 61, unit: "ms", measuredAt: at(0) },
        ...[1, 2, 3].map((d) => ({ kind: "hrv", value: 60, unit: "ms", measuredAt: at(d) })),
        { kind: "rhr", value: 50, unit: "bpm", measuredAt: at(0.5) },
      ],
      fitnessSessions: [{ kind: "ride", performedAt: at(1), durationMin: 75, distanceMi: 20 }],
    });
    mocks.readings.mockResolvedValue([{ kind: "weight", value: 61, unit: "kg", measuredAt: at(4) }]);
    const s = await loadHealth("u1", NOW);
    expect(s).toEqual({
      age: 35, sex: "F", heightIn: 66,
      weight: { value: 61, unit: "kg", at: NOW - 4 * DAY }, bodyFat: null, vo2: null,
      hrv: { latest: { value: 61, unit: "ms", at: NOW }, baseline: 60 },
      rhr: { latest: { value: 50, unit: "bpm", at: NOW - 0.5 * DAY }, baseline: null },
      conditions: ["Knee pain (left)", "Asthma"],
      activity: [{ kind: "ride", at: NOW - DAY, durationMin: 75, distanceMi: 20 }],
    });
    const query = mocks.human.mock.calls[0][0];
    expect(query.where).toEqual({ project: { userId: "u1", archived: false } });
    expect(query.select.biometrics.where).toEqual({ kind: { in: ["hrv", "rhr"] }, measuredAt: { gte: new Date(NOW - 33 * DAY) } });
    expect(query.select.fitnessSessions.where).toEqual({ performedAt: { gte: new Date(NOW - 3 * DAY) }, kind: { not: "lift" } });
    expect(mocks.readings).toHaveBeenCalledWith({
      where: { humanId: "h1", kind: { in: ["weight", "bodyFat", "vo2"] } }, orderBy: { measuredAt: "desc" }, distinct: ["kind"],
    });
  });
  it("is null without a profile", async () => {
    mocks.human.mockResolvedValue(null);
    expect(await loadHealth("u1", NOW)).toBeNull();
    expect(mocks.readings).not.toHaveBeenCalled();
  });
  it("turns a birthday tomorrow into last year's age", () => {
    const rows = { sex: null, heightInches: null, conditionsJson: null, recovery: [], body: [], activity: [] };
    expect(buildSnapshot({ ...rows, birthDate: new Date(Date.UTC(1985, 9, 18)) }, NOW).age).toBe(40);
    expect(buildSnapshot({ ...rows, birthDate: new Date(Date.UTC(1985, 9, 17)) }, NOW).age).toBe(41);
  });
});
