import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findProject: vi.fn(), createAsset: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: mocks.findProject },
    asset: { create: mocks.createAsset },
  },
}));
import { createAssetFromProposal } from "./smart-commit";
import type { AssetProposal } from "./smart-capture";

const base: AssetProposal = { type: "asset", assetKind: "media", title: "711" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAsset.mockImplementation(async ({ data }) => ({ id: "a1", ...data }));
});

describe("createAssetFromProposal", () => {
  it.each([
    ["inventory", "owned"],
    ["investment", "active"],
    ["media", "wishlist"],
    ["place", "wishlist"],
    ["practice", "active"],
  ] as const)("defaults %s status to %s", async (kind, status) => {
    await createAssetFromProposal("u1", { ...base, assetKind: kind });
    expect(mocks.createAsset.mock.calls[0][0].data.status).toBe(status);
  });

  it("maps the proposal and nulls what Claude left out", async () => {
    await createAssetFromProposal("u1", {
      ...base,
      status: "to-watch",
      subtitle: "Dir. Someone",
      category: "documentary",
      url: "https://example.com",
      details: { releaseYear: 2024, genre: "documentary" },
    });
    const data = mocks.createAsset.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "u1",
      kind: "media",
      title: "711",
      subtitle: "Dir. Someone",
      category: "documentary",
      status: "to-watch",
      url: "https://example.com",
      notes: null,
      imageUrl: null,
      rating: null,
      acquiredAt: null,
      projectId: null,
    });
    expect(data.detailsJson).toEqual({
      source: "smart-capture",
      sourceVendor: null,
      releaseYear: 2024,
      genre: "documentary",
    });
    expect(mocks.findProject).not.toHaveBeenCalled();
  });

  it("stamps acquiredAt today for owned inventory without a date", async () => {
    await createAssetFromProposal("u1", { ...base, assetKind: "inventory" });
    expect(mocks.createAsset.mock.calls[0][0].data.acquiredAt).toBeInstanceOf(Date);
  });

  it("only honours a projectId the user owns", async () => {
    mocks.findProject.mockResolvedValueOnce({ id: "p1", userId: "u1" });
    await createAssetFromProposal("u1", { ...base, projectId: "p1" });
    expect(mocks.createAsset.mock.calls[0][0].data.projectId).toBe("p1");
    mocks.findProject.mockResolvedValueOnce({ id: "p2", userId: "someone-else" });
    await createAssetFromProposal("u1", { ...base, projectId: "p2" });
    expect(mocks.createAsset.mock.calls[1][0].data.projectId).toBeNull();
  });

  it("records todo provenance over any same-named detail", async () => {
    await createAssetFromProposal(
      "u1",
      { ...base, details: { source: "claude", creator: "X" } },
      { source: "todo", sourceTodoId: "t1", sourceTodoTitle: "Watch: 711 documentary" },
    );
    expect(mocks.createAsset.mock.calls[0][0].data.detailsJson).toEqual({
      source: "todo",
      sourceVendor: null,
      creator: "X",
      sourceTodoId: "t1",
      sourceTodoTitle: "Watch: 711 documentary",
    });
  });
});
