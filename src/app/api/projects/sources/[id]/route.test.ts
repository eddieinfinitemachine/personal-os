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

  it("lets a candidate or suggested topic be dismissed, nothing else", async () => {
    for (const from of ["candidate", "suggested"]) {
      mocks.findUnique.mockResolvedValue({ id: "s1", userId: "u1", kind: "topic", state: from });
      expect((await PATCH(patch({ state: "dismissed" }), ctx)).status).toBe(200);
    }
    mocks.findUnique.mockResolvedValue({ id: "s1", userId: "u1", kind: "topic", state: "suggested" });
    for (const state of ["pinned", "accepted", "candidate", "auto"]) {
      expect((await PATCH(patch({ state }), ctx)).status).toBe(400);
    }
    mocks.findUnique.mockResolvedValue({ id: "s1", userId: "u1", kind: "topic", state: "accepted" });
    expect((await PATCH(patch({ state: "dismissed" }), ctx)).status).toBe(400);
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
});
