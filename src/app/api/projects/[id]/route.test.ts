import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), findUnique: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
import { PATCH } from "./route";

const patch = (body: unknown) =>
  new Request("https://example.invalid/api/projects/p1", { method: "PATCH", body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: "p1" }) };
const UPDATED = new Date("2026-10-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.findUnique.mockResolvedValue({ id: "p1", userId: "u1", updatedAt: UPDATED });
  mocks.update.mockImplementation(async ({ data }: { data: object }) => ({ id: "p1", ...data }));
});

describe("PATCH /api/projects/[id] visibility", () => {
  it("accepts auto, pinned and hidden", async () => {
    for (const visibility of ["pinned", "hidden", "auto"]) {
      const res = await PATCH(patch({ visibility }), ctx);
      expect(res.status).toBe(200);
      expect((await res.json()).project.visibility).toBe(visibility);
    }
  });

  it("doesn't count a pin or hide as activity (updatedAt kept), but other edits still bump it", async () => {
    await PATCH(patch({ visibility: "pinned" }), ctx);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ visibility: "pinned", updatedAt: UPDATED });
    await PATCH(patch({ visibility: "hidden", name: "Renamed" }), ctx);
    expect(mocks.update.mock.calls[1][0].data).toEqual({ name: "Renamed", visibility: "hidden" });
  });

  it("rejects anything else before touching the database", async () => {
    for (const visibility of ["archived", "", null, 1, "PINNED"]) {
      expect((await PATCH(patch({ visibility }), ctx)).status).toBe(400);
    }
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("leaves visibility alone when it isn't sent, and stays owner-scoped", async () => {
    await PATCH(patch({ name: "Renamed" }), ctx);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ name: "Renamed" });
    mocks.findUnique.mockResolvedValue({ id: "p1", userId: "other" });
    expect((await PATCH(patch({ visibility: "pinned" }), ctx)).status).toBe(404);
  });
});
