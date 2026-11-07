import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  projectFind: vi.fn(),
  humanFind: vi.fn(),
  humanUpdate: vi.fn(),
  loadHealthSummary: vi.fn(),
  askAboutHealth: vi.fn(),
  callClaudeText: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.getCurrentUserId }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: mocks.projectFind },
    human: { findUnique: mocks.humanFind, update: mocks.humanUpdate },
    pet: { findUnique: vi.fn() },
    vehicle: { findUnique: vi.fn() },
    todo: { findMany: vi.fn().mockResolvedValue([]) },
    note: { findMany: vi.fn().mockResolvedValue([]) },
    attachment: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/claude", async (original) => ({
  ...(await original<typeof import("@/lib/claude")>()),
  callClaudeText: mocks.callClaudeText,
}));
vi.mock("@/lib/health/load", () => ({ loadHealthSummary: mocks.loadHealthSummary }));
vi.mock("@/lib/health/ask", async (original) => ({
  ...(await original<typeof import("@/lib/health/ask")>()),
  askAboutHealth: mocks.askAboutHealth,
}));

import { POST } from "./route";

const call = (body: unknown = { question: "How am I doing?" }) =>
  POST(new Request("http://test.local/api/projects/p1/ask", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "p1" }),
  });

const stubProject = (kind: string, userId = "u1") => mocks.projectFind.mockResolvedValue({ id: "p1", userId, kind, name: "Example", createdAt: new Date() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  mocks.getCurrentUserId.mockResolvedValue("u1");
  stubProject("human");
  mocks.humanFind.mockResolvedValue({ id: "h1", pictureJson: null });
  mocks.loadHealthSummary.mockResolvedValue({ labs: { markers: [] } });
  mocks.askAboutHealth.mockResolvedValue({ answer: "Steady.", fellBack: false });
  mocks.callClaudeText.mockResolvedValue("Project answer.");
});

describe("POST /api/projects/[id]/ask for a health project", () => {
  it("requires a session", async () => {
    mocks.getCurrentUserId.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.askAboutHealth).not.toHaveBeenCalled();
  });

  it("refuses someone else's record", async () => {
    stubProject("human", "someone-else");
    expect((await call()).status).toBe(404);
    expect(mocks.humanFind).not.toHaveBeenCalled();
    expect(mocks.askAboutHealth).not.toHaveBeenCalled();
  });

  it("requires a question", async () => {
    expect((await call({ question: "  " })).status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const res = await POST(new Request("http://test.local/api/projects/p1/ask", { method: "POST", body: "{not json" }), {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
    expect(mocks.projectFind).not.toHaveBeenCalled();
    expect(mocks.askAboutHealth).not.toHaveBeenCalled();
  });

  it("answers from the summary and saves nothing", async () => {
    const res = await call({ question: "How am I doing?", history: [{ role: "user", content: "Earlier" }, { role: "system", content: "Bad" }] });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ answer: "Steady.", fellBack: false });
    expect(mocks.askAboutHealth.mock.calls[0][0]).toMatchObject({
      question: "How am I doing?",
      history: [{ role: "user", content: "Earlier" }],
      picture: null,
    });
    expect(mocks.humanUpdate).not.toHaveBeenCalled();
    expect(mocks.callClaudeText).not.toHaveBeenCalled();
  });

  it("logs only the failure type", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.askAboutHealth.mockRejectedValue(new Error("quoted health data"));
    const res = await call();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("quoted health data");
    expect(errorLog).toHaveBeenCalledWith("health chat failed: unknown");
    errorLog.mockRestore();
  });
});

describe("POST /api/projects/[id]/ask for other projects", () => {
  it("still uses the general assistant", async () => {
    stubProject("generic");
    const res = await call();
    expect(await res.json()).toEqual({ answer: "Project answer." });
    expect(mocks.askAboutHealth).not.toHaveBeenCalled();
  });
});
