import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const claude = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: claude.call }));

import { prisma } from "@/lib/prisma";
import { fileGranolaMeeting, granolaMeetingsDone, NOTHING_FOUND } from "@/lib/dating-filer";

// Never run write tests against the application's normal DATABASE_URL.
const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/disabled");
const enabled = process.env.DATING_GRANOLA_INTEGRATION === "1" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/dating_outstanding";
const userId = `granola-regression-${process.pid}`;
const meeting = { meetingId: "reliability-test", occurredAt: new Date("2026-09-03"), title: "Therapy", url: null, text: "Test" };

// These deliberately exercise PostgreSQL transactions and unique constraints;
// only the external language-model response is mocked.
describe.skipIf(!enabled)("Granola PostgreSQL persistence", () => {
  let firstId: string;
  let secondId: string;
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, name: "Granola regression" } });
    const first = await prisma.datingPerson.create({ data: { userId, name: "Ana" } });
    const second = await prisma.datingPerson.create({ data: { userId, name: "Bea" } });
    firstId = first.id;
    secondId = second.id;
    claude.call.mockReset().mockResolvedValue({ people: [
      { personId: firstId, name: "Ana", note: "Dinner", remember: ["Likes jazz"] },
      { personId: secondId, name: "Bea", note: "Coffee", remember: ["Likes tea"] },
      { name: "Cara", isNew: true, note: "Met at a party" },
    ] });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("rolls back suggestions and the first person when later SQL fails, then retries completely", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    let updates = 0;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((fn: (tx: Prisma.TransactionClient) => unknown) =>
      transaction(async (tx) => {
        const wrapped = new Proxy(tx, { get(target, key) {
          if (key !== "datingPerson") return Reflect.get(target, key);
          return new Proxy(tx.datingPerson, { get(delegate, method) {
            if (method !== "update") return Reflect.get(delegate, method);
            return async (args: Parameters<typeof tx.datingPerson.update>[0]) => {
              if (++updates === 2) await tx.$queryRaw`SELECT 1 / 0`;
              return tx.datingPerson.update(args);
            };
          } });
        } });
        return fn(wrapped);
      })
    ) as typeof prisma.$transaction);
    await expect(fileGranolaMeeting(userId, meeting, { markEmpty: true })).rejects.toThrow();
    spy.mockRestore();
    expect(await prisma.datingEvent.count({ where: { userId } })).toBe(0);
    expect(await prisma.datingSuggestion.count({ where: { userId } })).toBe(0);
    expect((await prisma.datingPerson.findUniqueOrThrow({ where: { id: firstId } })).remember).toEqual([]);
    expect(await granolaMeetingsDone(userId, [meeting.meetingId])).toEqual(new Set());
    expect(await fileGranolaMeeting(userId, meeting, { markEmpty: true })).toMatchObject({ status: "done" });
    expect(await prisma.datingEvent.count({ where: { userId } })).toBe(2);
    expect(await fileGranolaMeeting(userId, meeting)).toEqual({ status: "skipped" });
  });

  it("repairs a legacy partial meeting without changing the already-filed person's facts", async () => {
    await prisma.datingEvent.create({ data: {
      userId, personId: firstId, kind: "note", title: "Original", occurredAt: meeting.occurredAt,
      source: "granola", externalId: `granola:${meeting.meetingId}:${firstId}`,
    } });
    await prisma.datingPerson.update({ where: { id: firstId }, data: { remember: ["User edited"], stage: "ended" } });
    expect(await granolaMeetingsDone(userId, [meeting.meetingId])).toEqual(new Set());
    const res = await fileGranolaMeeting(userId, meeting);
    expect(res).toMatchObject({ status: "done", skipped: 1 });
    expect(await prisma.datingEvent.count({ where: { userId } })).toBe(2);
    expect(await prisma.datingPerson.findUnique({ where: { id: firstId } })).toMatchObject({ remember: ["User edited"], stage: "ended" });
  });

  it("serializes simultaneous filing through the unique completion marker", async () => {
    const proposal = await claude.call();
    let arrived = 0;
    let release!: () => void;
    const bothReady = new Promise<void>((resolve) => { release = resolve; });
    claude.call.mockImplementation(async () => {
      if (++arrived === 2) release();
      await bothReady;
      return proposal;
    });
    const results = await Promise.all([fileGranolaMeeting(userId, meeting), fileGranolaMeeting(userId, meeting)]);
    expect(results.map((r) => r.status).sort()).toEqual(["done", "skipped"]);
    expect(await prisma.datingEvent.count({ where: { userId } })).toBe(2);
    expect(await prisma.datingSuggestion.count({ where: { userId, status: "pending" } })).toBe(1);
  });

  it("repairs suggestion-only partial meetings while preserving reviewed suggestions", async () => {
    await prisma.datingSuggestion.create({ data: {
      userId, meetingId: meeting.meetingId, occurredAt: meeting.occurredAt,
      name: "Cara", summary: "Original", note: "Keep me", status: "dismissed",
    } });
    const res = await fileGranolaMeeting(userId, meeting);
    expect(res).toMatchObject({ status: "done", suggestions: [] });
    expect(await prisma.datingEvent.count({ where: { userId } })).toBe(2);
    expect(await prisma.datingSuggestion.findFirst({ where: { userId, name: "Cara" } }))
      .toMatchObject({ status: "dismissed", note: "Keep me" });
  });

  it("marks facts-only proposals complete even when there is no note event", async () => {
    claude.call.mockResolvedValue({ people: [{ personId: firstId, name: "Ana", remember: ["Likes jazz"] }] });
    expect(await fileGranolaMeeting(userId, meeting)).toMatchObject({ status: "done" });
    expect(await prisma.datingEvent.count({ where: { userId } })).toBe(0);
    expect(await fileGranolaMeeting(userId, meeting)).toEqual({ status: "skipped" });
    expect(claude.call).toHaveBeenCalledTimes(1);
  });

  it("keeps old empty-meeting markers complete", async () => {
    await prisma.datingSuggestion.create({ data: {
      userId, meetingId: meeting.meetingId, occurredAt: meeting.occurredAt,
      name: NOTHING_FOUND, summary: "", note: "", status: "dismissed",
    } });
    expect(await fileGranolaMeeting(userId, meeting)).toEqual({ status: "skipped" });
    expect(claude.call).not.toHaveBeenCalled();
  });
});
