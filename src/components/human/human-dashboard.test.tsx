import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    human: { findUnique: mocks.findUnique },
    labResult: { findMany: vi.fn().mockResolvedValue([]) },
    medicalVisit: { findMany: vi.fn().mockResolvedValue([]) },
    fitnessSession: { findMany: vi.fn().mockResolvedValue([]) },
    dnaResult: { findMany: vi.fn().mockResolvedValue([]) },
    biometricReading: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
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

beforeEach(() => {
  // Answers the way the database does, so a `take` limit really cuts rows.
  mocks.findUnique.mockImplementation(async ({ include }: { include: { labResults: { take?: number } } }) => ({
    ...human,
    labResults: labRows.slice(0, include.labResults.take ?? labRows.length),
  }));
});

describe("HumanDashboard", () => {
  it("keeps the oldest draw when there are more than 100 lab rows", async () => {
    const html = renderToStaticMarkup(await HumanDashboard({ projectId: "p1" }));
    for (const date of DRAWS) expect(html).toContain(date);
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
});
