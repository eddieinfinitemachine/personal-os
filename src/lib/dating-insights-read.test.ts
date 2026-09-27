import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { datingPerson: { findFirst: mocks.find } } }));
vi.mock("@/lib/dating-insights", () => ({ refreshDatingInsights: mocks.refresh }));
import { GET } from "@/app/api/dating/[id]/insights/route";
const read = () => GET(new Request("http://localhost/api/dating/p/insights"), { params: Promise.resolve({ id: "p" }) });

describe("reading saved insights", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue("owner"); });
  it("requires authentication", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await read()).status).toBe(401);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("selects only the owner's summary fields, never generates, and prevents response caching", async () => {
    mocks.find.mockResolvedValue({ insights: { summary: "Saved" }, insightsAt: new Date("2026-09-27") });
    const res = await read();
    expect(await res.json()).toEqual({ insights: { summary: "Saved" }, insightsAt: "2026-09-27T00:00:00.000Z" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.find).toHaveBeenCalledWith({ where: { id: "p", userId: "owner" }, select: { insights: true, insightsAt: true } });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("returns not found outside the owner scope", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await read()).status).toBe(404);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
