import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  project: vi.fn(),
  human: vi.fn(),
  update: vi.fn(),
  labs: vi.fn(),
  callClaudeJSON: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: mocks.project },
    human: { findUnique: mocks.human, update: mocks.update },
    labResult: { findMany: mocks.labs },
    medicalVisit: { findMany: vi.fn().mockResolvedValue([]) },
    fitnessSession: { findMany: vi.fn().mockResolvedValue([]) },
    dnaResult: { findMany: vi.fn().mockResolvedValue([]) },
    biometricReading: { count: vi.fn().mockResolvedValue(0) },
  },
}));
vi.mock("@/lib/claude", () => {
  class ClaudeAPIError extends Error {
    constructor(
      readonly status: number,
      body: string,
    ) {
      super(`Claude error ${status}: ${body}`);
    }
  }
  return { callClaudeJSON: mocks.callClaudeJSON, ClaudeAPIError };
});

import { ClaudeAPIError } from "@/lib/claude";
import { POST } from "./route";

const human = {
  id: "h1",
  sex: "M",
  birthDate: null,
  notes: null,
  medicationsJson: null,
  conditionsJson: null,
  allergiesJson: null,
  pictureJson: null,
};
const labRows = [
  {
    panel: "Lipids",
    marker: "Marker A",
    drawnAt: new Date("2030-01-10T00:00:00Z"),
    value: 140,
    unit: "mg/dL",
    refLow: null,
    refHigh: 150,
    flag: null,
    notes: null,
  },
];
const reply = {
  headline: "Marker A is 140.",
  focus: [{ title: "Watch Marker A", kind: "established", why: "It is 140.", next: "Retest.", markers: ["Marker A"] }],
  clear: [],
  blindSpots: [],
};

const call = (body: unknown = {}) =>
  POST(new Request("https://example.invalid/api/projects/p1/picture", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "p1" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.project.mockResolvedValue({ userId: "u1", kind: "human" });
  mocks.human.mockResolvedValue(human);
  mocks.labs.mockResolvedValue(labRows);
  mocks.update.mockResolvedValue({});
  mocks.callClaudeJSON.mockResolvedValue(reply);
});

describe("POST /api/projects/[id]/picture", () => {
  it("requires a session", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.callClaudeJSON).not.toHaveBeenCalled();
  });

  it("hides another user's project and non-health projects", async () => {
    mocks.project.mockResolvedValue({ userId: "someone-else", kind: "human" });
    expect((await call()).status).toBe(404);
    mocks.project.mockResolvedValue({ userId: "u1", kind: "vehicle" });
    expect((await call()).status).toBe(404);
    expect(mocks.callClaudeJSON).not.toHaveBeenCalled();
  });

  it("writes and stores a picture when none exists", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(true);
    expect(body.picture.headline).toBe("Marker A is 140.");
    expect(body.evidence["Marker A"].points[0].shown).toBe("140");
    expect(mocks.update.mock.calls[0][0].where).toEqual({ id: "h1" });
    expect(mocks.update.mock.calls[0][0].data.pictureJson.headline).toBe("Marker A is 140.");
  });

  it("spends nothing when the picture is current, unless forced", async () => {
    const first = await (await call()).json();
    mocks.human.mockResolvedValue({ ...human, pictureJson: first.picture });
    mocks.callClaudeJSON.mockClear();
    mocks.update.mockClear();

    const fresh = await (await call()).json();
    expect(fresh.updated).toBe(false);
    expect(fresh.picture.headline).toBe("Marker A is 140.");
    expect(mocks.callClaudeJSON).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();

    const forced = await (await call({ force: true })).json();
    expect(forced.updated).toBe(true);
    expect(mocks.callClaudeJSON).toHaveBeenCalledTimes(1);
  });

  it("writes nothing without lab data", async () => {
    mocks.labs.mockResolvedValue([]);
    const body = await (await call()).json();
    expect(body.picture).toBeNull();
    expect(mocks.callClaudeJSON).not.toHaveBeenCalled();
  });

  it("keeps the previous picture on failure and logs only the failure type", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.callClaudeJSON.mockRejectedValue(new ClaudeAPIError(500, "Marker A is 140"));
    const res = await call();
    expect(res.status).toBe(502);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(spy.mock.calls.flat().join(" ")).toBe("health picture failed: http_500");
    spy.mockRestore();
  });
});
