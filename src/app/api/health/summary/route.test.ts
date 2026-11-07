import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  projectFind: vi.fn(),
  humanFind: vi.fn(),
  humanUpdate: vi.fn(),
  loadHealthSummary: vi.fn(),
  isPictureStale: vi.fn(),
  callClaudeJSON: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: mocks.projectFind },
    human: { findUnique: mocks.humanFind, update: mocks.humanUpdate },
  },
}));
vi.mock("@/lib/claude", async (original) => ({
  ...(await original<typeof import("@/lib/claude")>()),
  callClaudeJSON: mocks.callClaudeJSON,
}));
vi.mock("@/lib/health/load", async (original) => ({
  ...(await original<typeof import("@/lib/health/load")>()),
  loadHealthSummary: mocks.loadHealthSummary,
}));
vi.mock("@/lib/health/picture", async (original) => ({
  ...(await original<typeof import("@/lib/health/picture")>()),
  isPictureStale: mocks.isPictureStale,
}));

import { GET } from "./route";

const DAY = 86_400_000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);

const summary = { today: "2030-06-15", labs: { draws: ["2030-01-10"], latestDraw: "2030-01-10", markers: [{ marker: "ApoB" }] } };
const storedPicture = {
  version: 1,
  headline: "ApoB is the one to watch.",
  focus: [],
  clear: [],
  blindSpots: [],
  generatedAt: "2030-06-01T12:00:00.000Z",
  fingerprint: { core: "c1", activity: "a1" },
  basedOn: { draws: 1, latestDraw: "2030-01-10" },
};
const reading = (kind: string, value: number) => ({
  kind,
  value,
  unit: "u",
  measuredAt: new Date("2030-06-01T00:00:00Z"),
  source: "apple-health",
});
const human = {
  id: "h1",
  userId: "u1",
  fullName: "Alex Rivera",
  sex: "M",
  birthDate: new Date("1990-04-02T00:00:00Z"),
  bloodType: "O+",
  heightInches: 70,
  primaryCarePhysician: "Dr. Example",
  pcpPhone: "555-0100",
  insurer: "Example Health",
  insurerPhone: "555-0101",
  // A row from the database could carry it; the response never may.
  policyNumber: "POLICY-SECRET-1",
  emergencyContactName: "Sam Rivera",
  emergencyContactPhone: "555-0102",
  notes: "My notes.",
  medicationsJson: [],
  conditionsJson: [],
  allergiesJson: [],
  pictureJson: storedPicture,
  // In the database's order (kind ascending).
  biometrics: ["bpSystolic", "hrv", "sleep", "someNewKind", "steps", "vo2", "weight"].map((kind, i) => reading(kind, i + 1)),
  vaccinations: [
    { id: "v1", name: "Tetanus", administeredAt: daysFromNow(-3000), boosterDueAt: daysFromNow(-5), provider: "Clinic", notes: null },
    { id: "v2", name: "Flu", administeredAt: daysFromNow(-330), boosterDueAt: daysFromNow(30), provider: null, notes: "Left arm" },
    { id: "v3", name: "Hep B", administeredAt: daysFromNow(-100), boosterDueAt: daysFromNow(200), provider: null, notes: null },
    { id: "v4", name: "MMR", administeredAt: daysFromNow(-9000), boosterDueAt: null, provider: null, notes: null },
  ],
  medicalVisits: [
    { id: "mv1", performedAt: new Date("2030-05-01T00:00:00Z"), providerName: "Dr. Example", specialty: "primary", reason: "Annual", summary: "Fine." },
  ],
  dnaResults: [
    { id: "d1", category: "trait", title: "Caffeine", finding: "Fast", detail: null, source: "23andMe", reportedAt: null },
  ],
  fitnessSessions: [
    {
      id: "f1",
      performedAt: new Date("2030-06-10T00:00:00Z"),
      kind: "run",
      durationMin: 30,
      distanceMi: 3.1,
      caloriesKcal: 300,
      avgHr: 150,
      maxHr: 170,
      notes: null,
      source: "strava",
    },
  ],
};

const EMPTY = {
  projectId: null,
  human: null,
  summary: null,
  picture: { stored: null, stale: false, generatedAt: null },
  vaccinations: [],
  visits: [],
  dna: [],
  biometrics: [],
  fitnessSessions: [],
};

const call = () => GET(new Request("https://example.invalid/api/health/summary"));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.projectFind.mockResolvedValue({ id: "p1" });
  mocks.humanFind.mockResolvedValue(human);
  mocks.loadHealthSummary.mockResolvedValue(summary);
  mocks.isPictureStale.mockReturnValue(true);
});

describe("GET /api/health/summary", () => {
  it("requires a session", async () => {
    mocks.user.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.projectFind).not.toHaveBeenCalled();
  });

  it("returns the empty shape for someone with no health record", async () => {
    mocks.projectFind.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual(EMPTY);
    expect(mocks.projectFind.mock.calls[0][0]).toMatchObject({
      where: { userId: "u1", kind: "human", archived: false },
      orderBy: { createdAt: "asc" },
    });
    expect(mocks.humanFind).not.toHaveBeenCalled();
  });

  it("returns the project id alone when the project has no profile yet", async () => {
    mocks.humanFind.mockResolvedValue(null);
    expect(await (await call()).json()).toEqual({ ...EMPTY, projectId: "p1" });
    expect(mocks.loadHealthSummary).not.toHaveBeenCalled();
  });

  it("returns everything the Health page shows, without the policy number", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();

    expect(body.projectId).toBe("p1");
    expect(body.human).toEqual({
      id: "h1",
      fullName: "Alex Rivera",
      sex: "M",
      birthDate: "1990-04-02T00:00:00.000Z",
      bloodType: "O+",
      heightInches: 70,
      careTeam: {
        primaryCarePhysician: "Dr. Example",
        pcpPhone: "555-0100",
        insurer: "Example Health",
        insurerPhone: "555-0101",
        emergencyContactName: "Sam Rivera",
        emergencyContactPhone: "555-0102",
      },
    });
    expect(body.summary).toEqual(summary);
    expect(body.picture).toEqual({ stored: storedPicture, stale: true, generatedAt: "2030-06-01T12:00:00.000Z" });

    expect(body.vaccinations.map((v: { name: string; status: string }) => [v.name, v.status])).toEqual([
      ["Tetanus", "overdue"],
      ["Flu", "due-soon"],
      ["Hep B", "ok"],
      ["MMR", "ok"],
    ]);
    expect(body.vaccinations[1]).toEqual({
      id: "v2",
      name: "Flu",
      administeredAt: human.vaccinations[1].administeredAt.toISOString(),
      boosterDueAt: human.vaccinations[1].boosterDueAt!.toISOString(),
      provider: null,
      notes: "Left arm",
      status: "due-soon",
    });

    expect(body.biometrics.map((b: { kind: string; label: string }) => [b.kind, b.label])).toEqual([
      ["weight", "Weight"],
      ["bpSystolic", "BP systolic"],
      ["hrv", "HRV"],
      ["vo2", "VO2 max"],
      ["steps", "Steps"],
      ["sleep", "Sleep"],
      ["someNewKind", "someNewKind"],
    ]);
    expect(body.biometrics[0]).toEqual({
      kind: "weight",
      label: "Weight",
      value: 7,
      unit: "u",
      measuredAt: "2030-06-01T00:00:00.000Z",
      source: "apple-health",
    });

    expect(body.visits).toEqual([
      { id: "mv1", performedAt: "2030-05-01T00:00:00.000Z", providerName: "Dr. Example", specialty: "primary", reason: "Annual", summary: "Fine." },
    ]);
    expect(body.dna).toEqual([{ id: "d1", category: "trait", title: "Caffeine", finding: "Fast", detail: null, source: "23andMe", reportedAt: null }]);
    expect(body.fitnessSessions).toEqual([{ ...human.fitnessSessions[0], performedAt: "2030-06-10T00:00:00.000Z" }]);

    const raw = JSON.stringify(body);
    expect(raw).not.toContain("policyNumber");
    expect(raw).not.toContain("POLICY-SECRET-1");
    expect(raw).not.toContain('"userId"');
  });

  it("reads the record the way the page does, and never the policy number", async () => {
    await call();
    const { where, select } = mocks.humanFind.mock.calls[0][0];
    expect(where).toEqual({ projectId: "p1" });
    expect(select.policyNumber).toBeUndefined();
    expect(select.biometrics.distinct).toEqual(["kind"]);
    expect(select.vaccinations.take).toBe(12);
    expect(select.medicalVisits.take).toBe(12);
    expect(select.dnaResults.take).toBe(30);
    expect(select.fitnessSessions.take).toBe(12);
    expect(mocks.loadHealthSummary).toHaveBeenCalledWith(human, expect.any(Date));
  });

  it("reports a fresh picture as not stale, and writes nothing", async () => {
    mocks.isPictureStale.mockReturnValue(false);
    const body = await (await call()).json();
    expect(body.picture.stale).toBe(false);
    expect(mocks.isPictureStale).toHaveBeenCalledWith(storedPicture, summary, expect.any(Date));
    expect(mocks.callClaudeJSON).not.toHaveBeenCalled();
    expect(mocks.humanUpdate).not.toHaveBeenCalled();
  });

  it("reports a missing picture as stale when there are labs to write it from", async () => {
    mocks.humanFind.mockResolvedValue({ ...human, pictureJson: null });
    const body = await (await call()).json();
    expect(body.picture).toEqual({ stored: null, stale: true, generatedAt: null });
    expect(mocks.isPictureStale).toHaveBeenCalledWith(null, summary, expect.any(Date));
    expect(mocks.callClaudeJSON).not.toHaveBeenCalled();
  });

  it("never asks for a picture without labs, as on the page", async () => {
    mocks.loadHealthSummary.mockResolvedValue({ ...summary, labs: { draws: [], latestDraw: null, markers: [] } });
    const body = await (await call()).json();
    expect(body.picture.stale).toBe(false);
    expect(mocks.isPictureStale).not.toHaveBeenCalled();
  });

  it("logs only the failure type", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.loadHealthSummary.mockRejectedValue(new Error("quoted health data"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await res.json())).not.toContain("quoted health data");
    expect(errorLog).toHaveBeenCalledWith("health summary failed: unknown");
    errorLog.mockRestore();
  });
});
