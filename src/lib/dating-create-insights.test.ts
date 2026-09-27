import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ after: vi.fn(), auth: vi.fn(), create: vi.fn(), refresh: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { datingPerson: { create: mocks.create } } }));
vi.mock("@/lib/dating-insights", () => ({ refreshDatingInsights: mocks.refresh }));
import { POST } from "@/app/api/dating/route";

const post = (body: unknown) => POST(new Request("http://localhost/api/dating", { method: "POST", body: JSON.stringify(body) }));
describe("first summary after adding someone", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue("owner");
    mocks.create.mockImplementation(async ({ data }) => ({ id: "person", ...data, metAt: null, endedAt: null,
      insightsAt: null, lastMessageAt: null, createdAt: new Date(), insights: null }));
  });
  it("returns the saved person before starting generation and scopes the callback to its owner", async () => {
    const res = await post({ name: "Ana", notes: "We met for coffee." });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ person: { id: "person", notes: "We met for coffee." } });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
    mocks.refresh.mockResolvedValue({ ok: true, refreshed: true });
    await mocks.after.mock.calls[0][0]();
    expect(mocks.refresh).toHaveBeenCalledWith("owner", "person");
  });
  it("schedules only saved nonblank notes", async () => {
    for (const notes of [undefined, "", "   "]) expect((await post({ name: "Ana", notes })).status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("keeps the saved person and contains both thrown and returned refresh failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await post({ name: "Ana", notes: "Original paragraph" });
      expect(await res.json()).toMatchObject({ person: { notes: "Original paragraph" } });
      const callback = mocks.after.mock.calls[0][0];
      mocks.refresh.mockRejectedValueOnce(new Error("private provider error"));
      await expect(callback()).resolves.toBeUndefined();
      mocks.refresh.mockResolvedValueOnce({ ok: false, status: 502, error: "safe error" });
      await expect(callback()).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(log.mock.calls)).not.toContain("private provider error");
      expect(mocks.create).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
  it("does not create or schedule when unauthenticated or invalid", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await post({ name: "Ana", notes: "Context" })).status).toBe(401);
    expect((await post({ name: "", notes: "Context" })).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
