import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimNextJob, failStaleJobs, requeueJob, spentLastDay, type AgentQueueDb } from "./claim";

const db = {
  agentJob: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn() },
} satisfies AgentQueueDb;

beforeEach(() => {
  vi.clearAllMocks();
  db.agentJob.findUnique.mockImplementation(async ({ where }) => ({ id: where.id, status: "running" }));
});

describe("claimNextJob", () => {
  it("claims the oldest queued code job for an allowed user with a status-guarded update", async () => {
    db.agentJob.findFirst.mockResolvedValueOnce({ id: "j1" });
    db.agentJob.updateMany.mockResolvedValueOnce({ count: 1 });
    const now = new Date("2026-10-30T10:00:00Z");
    const job = await claimNextJob(db, { allowedEmails: ["f@x.test"], now });
    expect(job).toEqual({ id: "j1", status: "running" });
    expect(db.agentJob.findFirst.mock.calls[0][0]).toMatchObject({
      where: { status: "queued", kind: "code", user: { email: { in: ["f@x.test"] } } },
      orderBy: { createdAt: "asc" },
    });
    expect(db.agentJob.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "j1", status: "queued" },
      data: { status: "running", startedAt: now, error: null },
    });
  });

  it("moves on when another worker won the row, and gives up after three tries", async () => {
    db.agentJob.findFirst.mockResolvedValue({ id: "j1" });
    db.agentJob.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimNextJob(db, { allowedEmails: ["f@x.test"] })).toBeNull();
    expect(db.agentJob.updateMany).toHaveBeenCalledTimes(3);
  });

  it("claims nothing without an allowlist or an empty queue", async () => {
    expect(await claimNextJob(db, { allowedEmails: [] })).toBeNull();
    expect(db.agentJob.findFirst).not.toHaveBeenCalled();
    db.agentJob.findFirst.mockResolvedValueOnce(null);
    expect(await claimNextJob(db, { allowedEmails: ["f@x.test"] })).toBeNull();
  });
});

describe("failStaleJobs / requeueJob / spentLastDay", () => {
  it("fails running jobs started before the cutoff", async () => {
    db.agentJob.updateMany.mockResolvedValueOnce({ count: 2 });
    const cutoff = new Date("2026-10-30T09:00:00Z");
    const now = new Date("2026-10-30T10:00:00Z");
    expect(await failStaleJobs(db, cutoff, now)).toBe(2);
    expect(db.agentJob.updateMany.mock.calls[0][0]).toMatchObject({
      where: { status: "running", startedAt: { lt: cutoff } },
      data: { status: "failed", completedAt: now },
    });
  });

  it("requeues only a running job", async () => {
    db.agentJob.updateMany.mockResolvedValueOnce({ count: 1 });
    await requeueJob(db, "j1");
    expect(db.agentJob.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "j1", status: "running" },
      data: { status: "queued", startedAt: null },
    });
  });

  it("sums the last 24 hours of cost, treating no rows as zero", async () => {
    const now = new Date("2026-10-30T10:00:00Z");
    db.agentJob.aggregate.mockResolvedValueOnce({ _sum: { costUsd: 12.5 } });
    expect(await spentLastDay(db, now)).toBe(12.5);
    expect(db.agentJob.aggregate.mock.calls[0][0]).toEqual({
      where: { completedAt: { gte: new Date("2026-10-29T10:00:00Z") } },
      _sum: { costUsd: true },
    });
    db.agentJob.aggregate.mockResolvedValueOnce({ _sum: { costUsd: null } });
    expect(await spentLastDay(db, now)).toBe(0);
  });
});
