import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), founder: vi.fn(), sourceFindMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { projectSource: { findMany: mocks.sourceFindMany } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/cron", () => ({ isFounderUser: mocks.founder }));
import { GET } from "./route";

const call = () => GET(new Request("https://example.invalid/api/projects/board"));
const at = "2026-11-07T15:00:00.000Z";

const card = (key: string, over: Record<string, unknown> = {}) => ({
  id: `src-${key}`,
  kind: "inferred",
  key,
  name: key,
  company: "Olto",
  description: `${key} status`,
  plan: [
    { text: `${key} first`, due: "2026-11-10", who: null, waiting: false },
    { text: `${key} second`, due: null, who: "Dana", waiting: true },
    { type: "problem", text: `${key} problem` },
  ],
  commits: [{ ref: `gmail:${key}`, kind: "email", title: "Thread", at, url: "https://mail.google.com/x" }],
  lastActivityAt: new Date(at),
  state: "auto",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("founder");
  mocks.founder.mockResolvedValue(true);
  mocks.sourceFindMany.mockResolvedValue([
    card("launch"),
    card("pinned", { state: "pinned" }),
    card("nope", { state: "hidden" }),
    card("done", { state: "finished" }),
    {
      ...card("latest"),
      kind: "inferred-run",
      state: "idle",
      plan: { lastCheckedAt: at, lastSuccessAt: at, error: null, keys: ["launch", "nope", "done"] },
    },
  ]);
});

describe("GET /api/projects/board", () => {
  it("401s when signed out", async () => {
    mocks.user.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.founder).not.toHaveBeenCalled();
    expect(mocks.sourceFindMany).not.toHaveBeenCalled();
  });

  it("404s for anyone but the founder, without reading the board", async () => {
    mocks.user.mockResolvedValue("friend");
    mocks.founder.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.founder).toHaveBeenCalledWith("friend");
    expect(mocks.sourceFindMany).not.toHaveBeenCalled();
  });

  it("gives the founder the page's buckets, with every step and the problem line", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const board = await res.json();
    expect(mocks.sourceFindMany).toHaveBeenCalledWith({ where: { userId: "founder", kind: { in: ["inferred", "inferred-run"] } } });

    // Pinned first; the pinned card wasn't in the latest run, so it's stale.
    expect(board.cards.map((c: { name: string; stale: boolean }) => [c.name, c.stale])).toEqual([["pinned", true], ["launch", false]]);
    expect(board.hidden.map((c: { name: string }) => c.name)).toEqual(["nope"]);
    expect(board.finished.map((c: { name: string }) => c.name)).toEqual(["done"]);
    expect(board.syncedAt).toBe(at);
    expect(board.refreshFailed).toBe(false);

    expect(board.cards[1]).toEqual({
      id: "inferred:src-launch",
      name: "launch",
      company: "Olto",
      visibility: "auto",
      lastActivityAt: at,
      status: "launch status",
      next: "launch first",
      steps: [
        { text: "launch first", due: "2026-11-10", who: null, waiting: false },
        { text: "launch second", due: null, who: "Dana", waiting: true },
      ],
      problem: "launch problem",
      evidence: [{ ref: "gmail:launch", kind: "email", title: "Thread", at, url: "https://mail.google.com/x" }],
      stale: false,
      sourceId: "src-launch",
    });
  });
});
