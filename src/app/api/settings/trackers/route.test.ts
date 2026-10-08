import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique, update: mocks.update } },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
import { GET, PUT } from "./route";
import { TEMPLATES } from "@/lib/templates";

const url = "https://example.invalid/api/settings/trackers";
const put = (body: unknown) =>
  new Request(url, {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.update.mockResolvedValue({});
});

describe("GET /api/settings/trackers", () => {
  it("401s without a session", async () => {
    mocks.user.mockResolvedValue(null);
    const res = await GET(new Request(url));
    expect(res.status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when never synced", async () => {
    mocks.findUnique.mockResolvedValue({ sidebarTrackers: null });
    const res = await GET(new Request(url));
    expect(await res.json()).toEqual({ trackers: null });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { sidebarTrackers: true },
    });
  });

  it("returns the stored order, dropping slugs that no longer exist", async () => {
    mocks.findUnique.mockResolvedValue({ sidebarTrackers: ["media", "gone", "trips", "media"] });
    const res = await GET(new Request(url));
    expect(await res.json()).toEqual({ trackers: ["media", "trips"] });
  });

  it("keeps an empty list distinct from never-synced", async () => {
    mocks.findUnique.mockResolvedValue({ sidebarTrackers: [] });
    const res = await GET(new Request(url));
    expect(await res.json()).toEqual({ trackers: [] });
  });
});

describe("PUT /api/settings/trackers", () => {
  it("401s without a session", async () => {
    mocks.user.mockResolvedValue(null);
    const res = await PUT(put({ trackers: ["media"] }));
    expect(res.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("stores the order, deduped first-wins", async () => {
    const res = await PUT(put({ trackers: ["inventory", "media", "inventory", "trips"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trackers: ["inventory", "media", "trips"] });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { sidebarTrackers: ["inventory", "media", "trips"] },
    });
  });

  it("accepts an empty list", async () => {
    const res = await PUT(put({ trackers: [] }));
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { sidebarTrackers: [] } });
  });

  it("caps at the number of templates", async () => {
    const all = TEMPLATES.map((t) => t.slug);
    const res = await PUT(put({ trackers: [...all, ...all] }));
    expect(await res.json()).toEqual({ trackers: all });
  });

  it.each([
    ["invalid JSON", "{"],
    ["a non-object body", ["media"]],
    ["a missing trackers field", {}],
    ["a non-array", { trackers: "media" }],
    ["an unknown slug", { trackers: ["media", "nope"] }],
    ["a non-string entry", { trackers: ["media", 3] }],
  ])("400s on %s", async (_label, body) => {
    const res = await PUT(put(body));
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
