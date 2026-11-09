import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findMany: mocks.findMany } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
import { GET } from "./route";
import { projectSummarySelect } from "@/lib/project-detail";

const call = (query = "") => GET(new Request(`https://example.invalid/api/projects${query}`));
const t = new Date("2026-03-04T05:06:07.000Z");
const row = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  kind,
  archived: false,
  createdAt: t,
  updatedAt: t,
  userId: "u1",
  vehicle: null,
  pet: null,
  human: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.findMany.mockResolvedValue([
    row("inbox", "generic"),
    row("volvo", "vehicle", { vehicle: { id: "v1" } }),
    row("cat", "pet", { pet: { id: "pet1" } }),
    row("health", "human", { human: { id: "h1" } }),
    row("empty-vehicle", "vehicle"),
  ]);
});

describe("GET /api/projects", () => {
  it("401s when signed out", async () => {
    mocks.user.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lists the caller's live projects with each kind's record id", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", archived: false },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: projectSummarySelect,
    });
    const { projects } = await res.json();
    expect(projects[1]).toEqual({
      id: "volvo",
      name: "volvo",
      kind: "vehicle",
      archived: false,
      createdAt: "2026-03-04T05:06:07.000Z",
      updatedAt: "2026-03-04T05:06:07.000Z",
      hasDashboard: true,
      vehicleId: "v1",
      petId: null,
      humanId: null,
    });
    expect(projects.map((p: Record<string, unknown>) => [p.id, p.hasDashboard, p.vehicleId, p.petId, p.humanId])).toEqual([
      ["inbox", false, null, null, null],
      ["volvo", true, "v1", null, null],
      ["cat", true, null, "pet1", null],
      ["health", true, null, null, "h1"],
      ["empty-vehicle", true, null, null, null],
    ]);
    // userId is only for the ownership check, not the response.
    expect(projects[0]).not.toHaveProperty("userId");
  });

  it("includes archived projects only with ?archived=1", async () => {
    await call("?archived=1");
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ userId: "u1" });
    await call("?archived=true");
    expect(mocks.findMany.mock.calls[1][0].where).toEqual({ userId: "u1", archived: false });
  });
});
