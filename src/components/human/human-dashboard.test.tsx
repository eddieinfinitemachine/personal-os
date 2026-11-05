import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), workouts: vi.fn(), nutrition: vi.fn(), biometrics: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    human: { findUnique: mocks.findUnique },
    labResult: { findMany: vi.fn().mockResolvedValue([]) },
    medicalVisit: { findMany: vi.fn().mockResolvedValue([]) },
    fitnessSession: { findMany: vi.fn().mockResolvedValue([]) },
    dnaResult: { findMany: vi.fn().mockResolvedValue([]) },
    biometricReading: { findMany: mocks.biometrics, count: vi.fn().mockResolvedValue(0) },
    workoutLog: { findMany: mocks.workouts },
    nutritionDay: { findMany: mocks.nutrition },
  },
}));

import { HumanDashboard } from "./human-dashboard";

// 60 rows in each of three draws: more than the 100 the page once loaded.
const DRAWS = ["2030-03-01", "2029-03-01", "2028-03-01"];
const labRows = DRAWS.flatMap((date) =>
  Array.from({ length: 60 }, (_, i) => ({
    id: `${date}-${i}`,
    drawnAt: new Date(`${date}T00:00:00Z`),
    panel: "Lipids",
    marker: `Marker ${i}`,
    value: i + 1,
    unit: "mg/dL",
    refLow: null,
    refHigh: 1000,
    flag: null,
    notes: null,
  })),
);

const human = {
  id: "h1",
  userId: "u1",
  fullName: "Alex Rivera",
  sex: "M",
  birthDate: null,
  bloodType: null,
  heightInches: null,
  notes: null,
  medicationsJson: null,
  conditionsJson: null,
  allergiesJson: null,
  pictureJson: null,
  biometrics: [],
  medicalVisits: [],
  vaccinations: [],
  fitnessSessions: [],
  dnaResults: [],
};

const DAY = 86_400_000;
const logRow = (daysAgo: number, extra: Record<string, unknown> = {}) => ({
  clientId: `w-${daysAgo}`,
  source: "guided",
  title: "Session",
  focus: "full-body",
  startedAt: new Date(Date.now() - daysAgo * DAY - 40 * 60_000),
  finishedAt: new Date(Date.now() - daysAgo * DAY),
  durationMin: 40,
  exercises: [],
  notes: null,
  ...extra,
});

const foodDay = (daysAgo: number, extra: Record<string, unknown> = {}) => ({
  date: new Date(new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10) + "T00:00:00Z"),
  caloriesKcal: 2105,
  proteinG: 150,
  carbsG: 210,
  fatG: 70,
  saturatedFatG: 22.4,
  fiberG: 31,
  sugarG: 48,
  sodiumMg: 2300,
  app: "Food App",
  ...extra,
});

beforeEach(() => {
  mocks.workouts.mockResolvedValue([]);
  mocks.nutrition.mockResolvedValue([]);
  mocks.biometrics.mockResolvedValue([]);
  // Answers the way the database does, so a `take` limit really cuts rows.
  mocks.findUnique.mockImplementation(async ({ include }: { include: { labResults: { take?: number } } }) => ({
    ...human,
    labResults: labRows.slice(0, include.labResults.take ?? labRows.length),
  }));
});

describe("HumanDashboard", () => {
  it("keeps the oldest draw when there are more than 100 lab rows", async () => {
    const html = renderToStaticMarkup(await HumanDashboard({ projectId: "p1" }));
    for (const date of ["Mar 1, 2030", "Mar 1, 2029", "Mar 1, 2028"]) expect(html).toContain(date);
  });

  it("shows the latest reading of every biometric kind under a plain name", async () => {
    const reading = (kind: string, value: number) => ({
      id: kind,
      kind,
      value,
      unit: "u",
      measuredAt: new Date("2030-03-01T00:00:00Z"),
    });
    mocks.findUnique.mockResolvedValue({
      ...human,
      labResults: [],
      biometrics: [
        reading("skinMarkings", 11),
        reading("bpSystolic", 12),
        reading("bpDiastolic", 13),
        reading("spo2", 14),
        reading("abi", 15),
        reading("eyePressure", 16),
        reading("someNewKind", 17),
        reading("weight", 18),
      ],
    });
    const html = renderToStaticMarkup(await HumanDashboard({ projectId: "p1" }));
    for (const label of ["Skin markings", "BP systolic", "BP diastolic", "Blood oxygen", "ABI", "Eye pressure", "someNewKind"]) {
      expect(html).toContain(label);
    }
    expect(html.indexOf(">Weight<", html.indexOf("Biometrics"))).toBeLessThan(html.indexOf("BP systolic"));
    expect(mocks.findUnique.mock.calls[0][0].include.biometrics.distinct).toEqual(["kind"]);
  });

  it("lists the latest workouts from the Workout tab, with a link to it", async () => {
    mocks.workouts.mockResolvedValue([
      logRow(1, { source: "strava", title: "Evening run", focus: "conditioning", notes: "5.0 mi · avg HR 150" }),
      logRow(3, {
        source: "board",
        title: "Class strength",
        focus: "lower",
        durationMin: 55,
        exercises: [{ name: "Back squat", equipment: "barbell", targetReps: 5, sets: [{ reps: 5, durationSec: null, load: "135 lb" }] }],
      }),
    ]);
    const html = renderToStaticMarkup(await HumanDashboard({ projectId: "p1" }));
    expect(html).toContain(" Workouts</h3>");
    expect(html).not.toContain("Fitness sessions");
    expect(html).toContain('href="/workout"');
    expect(html).toContain("Open Workout →");
    expect(html).toContain("Evening run");
    expect(html).toContain("5.0 mi · avg HR 150");
    expect(html).toContain("Strava");
    expect(html).toContain("Class strength");
    expect(html).toContain("lower · 55m · Whiteboard");
    expect(html.indexOf("Evening run")).toBeLessThan(html.indexOf("Class strength"));
    expect(mocks.workouts.mock.calls[0][0].where.userId).toBe("u1");
  });

  it("falls back to fitness sessions, then to a pointer to the Workout tab", async () => {
    mocks.findUnique.mockResolvedValue({
      ...human,
      labResults: [],
      fitnessSessions: [{ id: "f1", performedAt: new Date("2030-03-01T12:00:00Z"), kind: "swim", durationMin: 30, distanceMi: null }],
    });
    const withSessions = renderToStaticMarkup(await HumanDashboard({ projectId: "p1" }));
    expect(withSessions).toContain("swim");
    expect(withSessions).not.toContain("None logged yet.");

    mocks.findUnique.mockResolvedValue({ ...human, labResults: [] });
    const empty = renderToStaticMarkup(await HumanDashboard({ projectId: "p1" }));
    expect(empty).toContain("None logged yet.");
    expect(empty).toContain("Plan one on the Workout tab.");
    expect(empty).toContain('href="/workout"');
  });

  it("shows the last 7 days of diet from Apple Health", async () => {
    mocks.nutrition.mockResolvedValue([foodDay(0), foodDay(1, { proteinG: 160, saturatedFatG: null })]);
    // The latest of each kind feeds protein per pound.
    mocks.biometrics.mockImplementation(async (args: { distinct?: string[] }) =>
      args.distinct ? [{ kind: "weight", value: 180, unit: "lb", measuredAt: new Date(Date.now() - DAY) }] : [],
    );
    mocks.findUnique.mockResolvedValue({ ...human, labResults: [] });
    const html = renderToStaticMarkup(await HumanDashboard({ projectId: "p1" }));
    expect(html).toContain(" Nutrition</h3>");
    expect(html).toContain("Last 7 days · 2 logged");
    for (const fact of [">Calories<", "2,105 kcal", ">Protein<", "155 g", ">Fiber<", "31 g", ">Saturated fat<", "22.4 g"]) {
      expect(html).toContain(fact);
    }
    expect(html).toContain("0.86 g</span> protein per lb");
    expect(html).toContain("From Food App via Apple Health");
    expect(html).not.toContain("Nothing from Apple Health yet.");
  });

  it("says where the diet comes from without an app, and leaves out protein per lb without a weight", async () => {
    mocks.nutrition.mockResolvedValue([foodDay(0, { app: null })]);
    mocks.findUnique.mockResolvedValue({ ...human, labResults: [] });
    const html = renderToStaticMarkup(await HumanDashboard({ projectId: "p1" }));
    expect(html).toContain("From Apple Health");
    expect(html).not.toContain("via Apple Health");
    expect(html).not.toContain("protein per lb");
  });

  it("points to the Shortcut when nothing has come from Apple Health", async () => {
    mocks.findUnique.mockResolvedValue({ ...human, labResults: [] });
    const html = renderToStaticMarkup(await HumanDashboard({ projectId: "p1" }));
    expect(html).toContain(" Nutrition</h3>");
    expect(html).toContain("Nothing from Apple Health yet.");
    expect(html).toContain("A daily Shortcut can send your food app&#x27;s log here.");
    expect(html).toContain('href="https://github.com/eddieinfinitemachine/personal-os/blob/main/docs/shortcuts/apple-health.md"');
  });
});
