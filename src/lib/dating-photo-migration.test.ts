import { describe, expect, it, vi } from "vitest";
import { migrateDatingPhoto, type PhotoMigrationEntry } from "./dating-photo-migration";

const photo = { id: "photo", userId: "owner", personId: "person", url: "old" };
const target = "private";
function fixture() {
  const saved: PhotoMigrationEntry[] = [];
  let current = photo.url;
  const deps = {
    readSource: vi.fn(async () => Buffer.from("image")),
    copyPrivate: vi.fn(async () => target),
    readTarget: vi.fn(async () => Buffer.from("image")),
    currentUrl: vi.fn(async () => current),
    switchUrl: vi.fn(async () => { current = target; return true; }),
    deleteSource: vi.fn(async () => {}),
    save: vi.fn(async (entry: PhotoMigrationEntry) => { saved.push({ ...entry }); }),
  };
  return { deps, saved };
}

describe("dating photo migration", () => {
  it("verifies a private copy before switching and records the switch before deleting", async () => {
    const { deps, saved } = fixture();
    deps.switchUrl.mockImplementation(async () => { expect(deps.readTarget).toHaveBeenCalled(); return true; });
    deps.deleteSource.mockImplementation(async () => { expect(saved.at(-1)?.stage).toBe("switched"); });
    await migrateDatingPhoto(photo, undefined, deps);
    expect(saved.map((e) => e.stage)).toEqual(["copied", "switched", "complete"]);
    expect(deps.deleteSource).toHaveBeenCalledOnce();
  });
  it("does not update or delete when copied bytes differ", async () => {
    const { deps } = fixture();
    deps.readTarget.mockResolvedValue(Buffer.from("broken"));
    await expect(migrateDatingPhoto(photo, undefined, deps)).rejects.toThrow("verification");
    expect(deps.switchUrl).not.toHaveBeenCalled();
    expect(deps.deleteSource).not.toHaveBeenCalled();
  });
  it("retries cleanup after failure without copying or changing the row again", async () => {
    const { deps, saved } = fixture();
    deps.deleteSource.mockRejectedValueOnce(new Error("storage down"));
    await expect(migrateDatingPhoto(photo, undefined, deps)).rejects.toThrow("storage down");
    await migrateDatingPhoto(photo, saved.at(-1), deps);
    expect(deps.copyPrivate).toHaveBeenCalledOnce();
    expect(deps.switchUrl).toHaveBeenCalledOnce();
    expect(saved.at(-1)?.stage).toBe("complete");
  });
  it("recovers a DB update that succeeded before the manifest write failed", async () => {
    const { deps, saved } = fixture();
    deps.save.mockImplementationOnce(async (e) => { saved.push({ ...e }); }).mockRejectedValueOnce(new Error("disk full"));
    await expect(migrateDatingPhoto(photo, undefined, deps)).rejects.toThrow("disk full");
    deps.save.mockImplementation(async (e) => { saved.push({ ...e }); });
    await migrateDatingPhoto(photo, saved[0], deps);
    expect(deps.switchUrl).toHaveBeenCalledOnce();
    expect(saved.at(-1)?.stage).toBe("complete");
  });
  it("preserves the source on a concurrent database change", async () => {
    const { deps } = fixture();
    deps.switchUrl.mockResolvedValue(false);
    await expect(migrateDatingPhoto(photo, undefined, deps)).rejects.toThrow("changed");
    expect(deps.deleteSource).not.toHaveBeenCalled();
  });
});
