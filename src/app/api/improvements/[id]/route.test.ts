import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  founder: vi.fn(),
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { improvement: { findFirst: mocks.findFirst, deleteMany: mocks.deleteMany, updateMany: mocks.updateMany } },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/cron", () => ({ isFounderUser: mocks.founder }));
import { DELETE, PATCH } from "./route";

const url = "https://example.invalid/api/improvements/i1";
const del = () => new Request(url, { method: "DELETE" });
const patch = (body: unknown) =>
  new Request(url, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: "i1" }) };
const created = new Date("2026-11-02T12:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  request: "Show due dates on Board cards",
  context: null,
  status: "approved",
  summary: "Added due dates to Board cards.",
  reviewReason: "Touches the Board query.",
  prUrl: "https://github.example.invalid/pr/1",
  previewUrl: null,
  error: null,
  createdAt: created,
  completedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("founder");
  mocks.founder.mockResolvedValue(true);
  mocks.findFirst.mockResolvedValue(row());
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("DELETE /api/improvements/[id]", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await DELETE(del(), ctx)).status).toBe(401);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("403s for anyone but the founder", async () => {
    mocks.user.mockResolvedValueOnce("friend");
    mocks.founder.mockResolvedValueOnce(false);
    expect((await DELETE(del(), ctx)).status).toBe(403);
    expect(mocks.founder).toHaveBeenCalledWith("friend");
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes only the caller's queued request", async () => {
    const res = await DELETE(del(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: "i1", userId: "founder", status: "queued" } });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("404s when the request isn't the caller's", async () => {
    mocks.deleteMany.mockResolvedValueOnce({ count: 0 });
    mocks.findFirst.mockResolvedValueOnce(null);
    expect((await DELETE(del(), ctx)).status).toBe(404);
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "i1", userId: "founder" });
  });

  it("409s once the worker has picked it up", async () => {
    mocks.deleteMany.mockResolvedValueOnce({ count: 0 });
    mocks.findFirst.mockResolvedValueOnce({ id: "i1" });
    const res = await DELETE(del(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Only queued requests can be cancelled.");
  });
});

describe("PATCH /api/improvements/[id]", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await PATCH(patch({ action: "approve" }), ctx)).status).toBe(401);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("403s for anyone but the founder", async () => {
    mocks.user.mockResolvedValueOnce("friend");
    mocks.founder.mockResolvedValueOnce(false);
    expect((await PATCH(patch({ action: "approve" }), ctx)).status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("400s on bad JSON or any action but approve", async () => {
    for (const body of ["not json", null, {}, { action: "ship" }, { action: "APPROVE" }, ["approve"]]) {
      expect((await PATCH(patch(body), ctx)).status).toBe(400);
    }
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("approves a request waiting for review and returns it", async () => {
    const res = await PATCH(patch({ action: "approve" }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "i1", userId: "founder", status: "needs_review" },
      data: { status: "approved", error: null },
    });
    const reread = mocks.findFirst.mock.calls[0][0];
    expect(reread.where).toEqual({ id: "i1", userId: "founder" });
    expect(reread.select.reviewReason).toBe(true);
    const body = await res.json();
    expect(body.improvement).toMatchObject({ id: "i1", status: "approved", createdAt: created.toISOString() });
  });

  it("404s when the request isn't the caller's", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findFirst.mockResolvedValueOnce(null);
    expect((await PATCH(patch({ action: "approve" }), ctx)).status).toBe(404);
  });

  it("409s when the request isn't waiting for review", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findFirst.mockResolvedValueOnce({ id: "i1" });
    const res = await PATCH(patch({ action: "approve" }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Only requests waiting for review can be shipped.");
  });
});
