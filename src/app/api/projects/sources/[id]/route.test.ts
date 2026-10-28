import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), findUnique: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { projectSource: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
import { PATCH } from "./route";

const patch = (body: unknown) =>
  new Request("https://example.invalid/api/projects/sources/s1", { method: "PATCH", body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: "s1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.update.mockImplementation(async ({ data }: { data: { state: string } }) => ({ id: "s1", state: data.state }));
});

describe("PATCH /api/projects/sources/[id]", () => {
  it("401s without a session and 404s on someone else's source", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await PATCH(patch({ state: "pinned" }), ctx)).status).toBe(401);
    mocks.findUnique.mockResolvedValue({ id: "s1", userId: "other", kind: "repo", state: "auto" });
    expect((await PATCH(patch({ state: "pinned" }), ctx)).status).toBe(404);
    mocks.findUnique.mockResolvedValue(null);
    expect((await PATCH(patch({ state: "pinned" }), ctx)).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps syncedAt (the last GitHub sync) when the state changes", async () => {
    const syncedAt = new Date("2026-10-27T10:00:00Z");
    mocks.findUnique.mockResolvedValue({ id: "s1", userId: "u1", kind: "repo", state: "auto", syncedAt });
    await PATCH(patch({ state: "pinned" }), ctx);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ state: "pinned", syncedAt });
  });

  it("lets a repo be pinned, hidden or put back on auto, nothing else", async () => {
    mocks.findUnique.mockResolvedValue({ id: "s1", userId: "u1", kind: "repo", state: "auto" });
    for (const state of ["pinned", "hidden", "auto"]) {
      expect((await PATCH(patch({ state }), ctx)).status).toBe(200);
    }
    expect(mocks.update.mock.calls.map((c) => c[0].data.state)).toEqual(["pinned", "hidden", "auto"]);
    for (const state of ["dismissed", "accepted", "suggested", "", 3]) {
      expect((await PATCH(patch({ state }), ctx)).status).toBe(400);
    }
    expect(mocks.update).toHaveBeenCalledTimes(3);
  });

  it("404s on non-repo rows (old meeting topics)", async () => {
    for (const state of ["candidate", "suggested", "accepted"]) {
      mocks.findUnique.mockResolvedValue({ id: "s1", userId: "u1", kind: "topic", state });
      for (const to of ["dismissed", "pinned", "hidden", "auto"]) {
        expect((await PATCH(patch({ state: to }), ctx)).status).toBe(404);
      }
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
