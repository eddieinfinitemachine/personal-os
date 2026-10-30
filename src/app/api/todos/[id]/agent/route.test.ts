import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  founder: vi.fn(),
  jobFindFirst: vi.fn(),
  jobFindUnique: vi.fn(),
  jobUpsert: vi.fn(),
  todoFindFirst: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentJob: { findFirst: mocks.jobFindFirst, findUnique: mocks.jobFindUnique, upsert: mocks.jobUpsert },
    todo: { findFirst: mocks.todoFindFirst },
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/cron", () => ({ isFounderUser: mocks.founder }));
import { GET, POST } from "./route";

const url = "https://example.invalid/api/todos/t1/agent";
const params = Promise.resolve({ id: "t1" });
const post = (body: unknown) => new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const created = new Date("2026-10-30T12:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  id: "j1", todoId: "t1", kind: "code", status: "queued", confidence: null, plan: "Queued by hand.", repo: "eddie/demo",
  branch: null, resultUrl: null, summary: null, error: null, costUsd: null, createdAt: created, completedAt: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AGENT_REPOS", "eddie/demo=demo app");
  mocks.user.mockResolvedValue("founder");
  mocks.founder.mockResolvedValue(true);
  mocks.todoFindFirst.mockResolvedValue({ id: "t1" });
  mocks.jobFindFirst.mockResolvedValue(null);
  mocks.jobFindUnique.mockResolvedValue(null);
  mocks.jobUpsert.mockImplementation(async ({ create }) => row({ ...create }));
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/todos/[id]/agent", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(new Request(url), { params })).status).toBe(401);
  });

  it("returns the caller's job for the todo, or null", async () => {
    let res = await GET(new Request(url), { params });
    expect(await res.json()).toEqual({ job: null });
    mocks.jobFindFirst.mockResolvedValueOnce(row({ status: "done", resultUrl: "https://github.com/eddie/demo/pull/7", completedAt: created }));
    res = await GET(new Request(url), { params });
    expect(mocks.jobFindFirst.mock.calls[1][0].where).toEqual({ todoId: "t1", userId: "founder" });
    expect((await res.json()).job).toMatchObject({ status: "done", resultUrl: "https://github.com/eddie/demo/pull/7", createdAt: created.toISOString(), completedAt: created.toISOString() });
  });
});

describe("POST /api/todos/[id]/agent", () => {
  it("401s without a user and 403s for anyone but the founder", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(post({ repo: "eddie/demo" }), { params })).status).toBe(401);
    mocks.founder.mockResolvedValueOnce(false);
    expect((await POST(post({ repo: "eddie/demo" }), { params })).status).toBe(403);
    expect(mocks.jobUpsert).not.toHaveBeenCalled();
  });

  it("404s for a todo the caller does not own", async () => {
    mocks.todoFindFirst.mockResolvedValueOnce(null);
    expect((await POST(post({ repo: "eddie/demo" }), { params })).status).toBe(404);
    expect(mocks.todoFindFirst.mock.calls[0][0].where).toEqual({ id: "t1", userId: "founder" });
  });

  it("400s on bad JSON or a repo outside AGENT_REPOS", async () => {
    expect((await POST(post("{nope"), { params })).status).toBe(400);
    const res = await POST(post({ repo: "someone/else" }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("eddie/demo");
  });

  it("409s while a job is queued or running", async () => {
    mocks.jobFindUnique.mockResolvedValueOnce({ status: "running" });
    expect((await POST(post({ repo: "eddie/demo" }), { params })).status).toBe(409);
    expect(mocks.jobUpsert).not.toHaveBeenCalled();
  });

  it("queues a code job by hand, resetting a previous result", async () => {
    mocks.jobFindUnique.mockResolvedValueOnce({ status: "failed" });
    const res = await POST(post({ repo: "eddie/demo" }), { params });
    expect(res.status).toBe(200);
    const args = mocks.jobUpsert.mock.calls[0][0];
    expect(args.where).toEqual({ todoId: "t1" });
    expect(args.create).toMatchObject({ userId: "founder", todoId: "t1", kind: "code", status: "queued", repo: "eddie/demo" });
    expect(args.update).toMatchObject({ status: "queued", repo: "eddie/demo", error: null, resultUrl: null, completedAt: null });
    expect((await res.json()).job).toMatchObject({ kind: "code", status: "queued", repo: "eddie/demo" });
  });
});
