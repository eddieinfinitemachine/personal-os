import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimNextImprovement, failStaleImprovements, requeueImprovement, type ImprovementQueueDb } from "./claim";

const now = new Date("2026-11-02T12:00:00Z");
const db = {
  improvement: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
};
const queue = db as unknown as ImprovementQueueDb;
const allowedEmails = ["founder@example.test"];

beforeEach(() => {
  vi.resetAllMocks();
  db.improvement.findFirst.mockImplementation(async ({ where }) => (where.status === "queued" ? { id: "q1" } : null));
  db.improvement.updateMany.mockResolvedValue({ count: 1 });
  db.improvement.findUnique.mockImplementation(async ({ where }) => ({ id: where.id, status: "running" }));
});

describe("claimNextImprovement", () => {
  it("claims the oldest queued request of an allowed user to implement, with a status-guarded update", async () => {
    const claimed = await claimNextImprovement(queue, { allowedEmails, now });
    expect(claimed).toEqual({ improvement: { id: "q1", status: "running" }, kind: "implement" });
    expect(db.improvement.findFirst).toHaveBeenCalledWith({
      where: { status: "queued", user: { email: { in: allowedEmails } } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    expect(db.improvement.updateMany).toHaveBeenCalledWith({
      where: { id: "q1", status: "queued" },
      data: { status: "running", startedAt: now, completedAt: null, error: null },
    });
  });

  it("ships an approved row before implementing anything queued", async () => {
    db.improvement.findFirst.mockImplementation(async ({ where }) => ({ id: where.status === "approved" ? "a1" : "q1" }));
    const claimed = await claimNextImprovement(queue, { allowedEmails, now });
    expect(claimed?.kind).toBe("ship");
    expect(claimed?.improvement.id).toBe("a1");
    expect(db.improvement.findFirst.mock.calls[0][0].where.status).toBe("approved");
    expect(db.improvement.updateMany).toHaveBeenCalledTimes(1);
    expect(db.improvement.updateMany.mock.calls[0][0].where).toEqual({ id: "a1", status: "approved" });
  });

  it("returns null when nothing is approved or queued", async () => {
    db.improvement.findFirst.mockResolvedValue(null);
    expect(await claimNextImprovement(queue, { allowedEmails, now })).toBeNull();
    expect(db.improvement.findFirst).toHaveBeenCalledTimes(2);
    expect(db.improvement.updateMany).not.toHaveBeenCalled();
  });

  it("moves on to the next row when another worker won the race", async () => {
    db.improvement.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "q1" }).mockResolvedValueOnce({ id: "q2" });
    db.improvement.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const claimed = await claimNextImprovement(queue, { allowedEmails, now });
    expect(claimed).toMatchObject({ kind: "implement", improvement: { id: "q2" } });
    expect(db.improvement.findUnique).toHaveBeenCalledTimes(1);
  });

  it("gives up after repeated lost races instead of spinning", async () => {
    db.improvement.findFirst.mockResolvedValue({ id: "x" });
    db.improvement.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimNextImprovement(queue, { allowedEmails, now })).toBeNull();
    expect(db.improvement.updateMany).toHaveBeenCalledTimes(6); // three tries per status
  });

  it("claims nothing without an allowlist", async () => {
    expect(await claimNextImprovement(queue, { allowedEmails: [], now })).toBeNull();
    expect(db.improvement.findFirst).not.toHaveBeenCalled();
  });
});

describe("failStaleImprovements / requeueImprovement", () => {
  it("fails only running improvements started before the cutoff", async () => {
    db.improvement.updateMany.mockResolvedValueOnce({ count: 2 });
    const cutoff = new Date("2026-11-02T10:00:00Z");
    expect(await failStaleImprovements(queue, cutoff, now)).toBe(2);
    expect(db.improvement.updateMany).toHaveBeenCalledWith({
      where: { status: "running", startedAt: { lt: cutoff } },
      data: { status: "failed", error: "The improve worker stopped before this finished.", completedAt: now },
    });
  });

  it("puts a stopped job back where it came from", async () => {
    await requeueImprovement(queue, "q1", "implement");
    await requeueImprovement(queue, "a1", "ship");
    expect(db.improvement.updateMany.mock.calls.map(([args]) => args)).toEqual([
      { where: { id: "q1", status: "running" }, data: { status: "queued", startedAt: null } },
      { where: { id: "a1", status: "running" }, data: { status: "approved", startedAt: null } },
    ]);
  });
});
