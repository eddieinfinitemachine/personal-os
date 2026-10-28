import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimNextReport, failStaleReports, requeueReport, type ResearchQueueDb } from "./claim";

const now = new Date("2026-10-27T12:00:00Z");
const db = {
  researchReport: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
};
const queue = db as unknown as ResearchQueueDb;

beforeEach(() => {
  vi.clearAllMocks();
  db.researchReport.findFirst.mockResolvedValue({ id: "r1" });
  db.researchReport.updateMany.mockResolvedValue({ count: 1 });
  db.researchReport.findUnique.mockImplementation(async ({ where }) => ({ id: where.id, status: "running" }));
});

describe("claimNextReport", () => {
  it("claims the oldest queued report of an allowed user with a status-guarded update", async () => {
    const report = await claimNextReport(queue, { allowedEmails: ["founder@example.test"], now });
    expect(report).toMatchObject({ id: "r1", status: "running" });
    expect(db.researchReport.findFirst).toHaveBeenCalledWith({
      where: { status: "queued", user: { email: { in: ["founder@example.test"] } } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    expect(db.researchReport.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", status: "queued" },
      data: { status: "running", startedAt: now, error: null },
    });
  });

  it("returns null when nothing is queued", async () => {
    db.researchReport.findFirst.mockResolvedValueOnce(null);
    expect(await claimNextReport(queue, { allowedEmails: ["founder@example.test"], now })).toBeNull();
    expect(db.researchReport.updateMany).not.toHaveBeenCalled();
  });

  it("moves on to the next report when another worker won the race", async () => {
    db.researchReport.findFirst.mockResolvedValueOnce({ id: "r1" }).mockResolvedValueOnce({ id: "r2" });
    db.researchReport.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const report = await claimNextReport(queue, { allowedEmails: ["founder@example.test"], now });
    expect(report?.id).toBe("r2");
    expect(db.researchReport.findUnique).toHaveBeenCalledTimes(1);
  });

  it("gives up after repeated lost races instead of spinning", async () => {
    db.researchReport.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimNextReport(queue, { allowedEmails: ["founder@example.test"], now })).toBeNull();
    expect(db.researchReport.updateMany).toHaveBeenCalledTimes(3);
  });

  it("claims nothing without an allowlist", async () => {
    expect(await claimNextReport(queue, { allowedEmails: [], now })).toBeNull();
    expect(db.researchReport.findFirst).not.toHaveBeenCalled();
  });
});

describe("failStaleReports / requeueReport", () => {
  it("fails only running reports started before the cutoff", async () => {
    db.researchReport.updateMany.mockResolvedValueOnce({ count: 2 });
    const cutoff = new Date("2026-10-27T11:00:00Z");
    expect(await failStaleReports(queue, cutoff, now)).toBe(2);
    const args = db.researchReport.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: "running", startedAt: { lt: cutoff } });
    expect(args.data).toMatchObject({ status: "failed", completedAt: now });
    expect(args.data.error).toMatch(/stopped/);
  });

  it("requeues only a report that is still running", async () => {
    await requeueReport(queue, "r1");
    expect(db.researchReport.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", status: "running" },
      data: { status: "queued", startedAt: null },
    });
  });
});
