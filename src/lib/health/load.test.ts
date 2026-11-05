import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  labs: vi.fn(),
  workouts: vi.fn(),
  biometrics: vi.fn(),
  nutrition: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    labResult: { findMany: mocks.labs },
    medicalVisit: { findMany: vi.fn().mockResolvedValue([]) },
    fitnessSession: { findMany: vi.fn().mockResolvedValue([]) },
    dnaResult: { findMany: vi.fn().mockResolvedValue([]) },
    biometricReading: { findMany: mocks.biometrics, count: vi.fn().mockResolvedValue(3) },
    workoutLog: { findMany: mocks.workouts },
    nutritionDay: { findMany: mocks.nutrition },
  },
}));

import { loadHealthSummary } from "./load";

const now = new Date("2030-06-15T12:00:00Z");
const human = {
  id: "h1",
  userId: "u1",
  sex: "M",
  birthDate: null,
  notes: null,
  medicationsJson: null,
  conditionsJson: null,
  allergiesJson: null,
};
const labRow = {
  panel: "Lipids",
  marker: "Marker A",
  drawnAt: new Date("2030-01-10T00:00:00Z"),
  value: 140,
  unit: "mg/dL",
  refLow: null,
  refHigh: 150,
  flag: null,
  notes: null,
};
const hrvRow = { kind: "hrv", value: 50, unit: "ms", measuredAt: new Date("2030-06-15T07:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.labs.mockResolvedValue([labRow]);
  // The latest of each kind, and the recovery readings, are separate queries.
  mocks.biometrics.mockImplementation(async (args: { distinct?: string[] }) => (args.distinct ? [] : [hrvRow]));
  mocks.workouts.mockResolvedValue([
    {
      clientId: "w-1",
      source: "guided",
      title: "Lower day",
      focus: "lower",
      startedAt: new Date("2030-06-10T11:20:00Z"),
      finishedAt: new Date("2030-06-10T12:00:00Z"),
      durationMin: 40,
      exercises: [{ name: "Goblet squat", equipment: "dumbbell", targetReps: 10, sets: [{ reps: 10, durationSec: null, load: "35 lb" }] }],
      notes: null,
    },
  ]);
  mocks.nutrition.mockResolvedValue([
    {
      date: new Date("2030-06-14T00:00:00Z"),
      caloriesKcal: 2100,
      proteinG: 150,
      carbsG: null,
      fatG: null,
      saturatedFatG: null,
      fiberG: 31,
      sugarG: null,
      sodiumMg: null,
      app: "Food App",
    },
  ]);
});

describe("loadHealthSummary", () => {
  it("reads the person's workout log and recovery readings", async () => {
    const summary = await loadHealthSummary(human, now);
    expect(summary.training.sessions).toBe(1);
    expect(summary.training.lifts[0]).toMatchObject({ name: "Goblet squat", next: "40 lb" });
    expect(summary.recovery.hrv?.latest).toEqual({ date: "2030-06-15", value: 50, unit: "ms" });

    const workoutQuery = mocks.workouts.mock.calls[0][0];
    expect(workoutQuery.where.userId).toBe("u1");
    expect(workoutQuery.where.finishedAt.gte).toEqual(new Date("2030-03-17T12:00:00Z"));
    const recoveryQuery = mocks.biometrics.mock.calls.find(([args]) => !args.distinct)![0];
    expect(recoveryQuery.where).toMatchObject({ humanId: "h1", kind: { in: ["hrv", "rhr"] } });
    expect(recoveryQuery.where.measuredAt.gte).toEqual(new Date("2030-05-13T12:00:00Z"));
  });

  it("reads a missing workout table as an empty log, and loads the rest", async () => {
    mocks.workouts.mockRejectedValue(Object.assign(new Error("table does not exist"), { code: "P2021" }));
    const summary = await loadHealthSummary(human, now);
    expect(summary.training.sessions).toBe(0);
    expect(summary.training.lastSession).toBeNull();
    expect(summary.labs.markers.map((m) => m.marker)).toEqual(["Marker A"]);
    expect(summary.recovery.hrv).not.toBeNull();
    expect(summary.coverage.biometricReadings).toBe(3);
  });

  it("reads the last 28 days of diet as YYYY-MM-DD days", async () => {
    const summary = await loadHealthSummary(human, now);
    expect(summary.nutrition).toMatchObject({ daysLogged: 1, app: "Food App", latestDay: "2030-06-14" });
    expect(summary.nutrition.recent[0]).toMatchObject({ date: "2030-06-14", caloriesKcal: 2100, proteinG: 150 });
    const query = mocks.nutrition.mock.calls[0][0];
    expect(query.where).toEqual({ userId: "u1", date: { gte: new Date("2030-05-18T12:00:00Z") } });
    expect(query).toMatchObject({ orderBy: { date: "desc" }, take: 60 });
  });

  it("reads a missing NutritionDay table as no diet, and loads the rest", async () => {
    mocks.nutrition.mockRejectedValue(Object.assign(new Error("table does not exist"), { code: "P2021" }));
    const summary = await loadHealthSummary(human, now);
    expect(summary.nutrition).toMatchObject({ daysLogged: 0, latestDay: null, recent: [] });
    expect(summary.training.sessions).toBe(1);
    expect(summary.labs.markers.map((m) => m.marker)).toEqual(["Marker A"]);
  });

  it("fails on any other database error", async () => {
    mocks.workouts.mockRejectedValue(Object.assign(new Error("connection lost"), { code: "P1001" }));
    await expect(loadHealthSummary(human, now)).rejects.toThrow("connection lost");
  });
});
