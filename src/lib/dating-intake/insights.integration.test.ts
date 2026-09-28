import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
const model = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: model.call }));
import { prisma } from "@/lib/prisma";
import { refreshDatingInsights } from "@/lib/dating-insights";
import { updateWithIdentity } from "./people";
const enabled = process.env.RUN_DATING_INTAKE_INTEGRATION === "1";
if (enabled) {
  const u = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55442" ||
    u.pathname !== "/dating_intake"
  )
    throw Error("Scratch required");
}
describe.skipIf(!enabled)("all-source summary freshness", () => {
  let userId: string, id: string;
  beforeEach(async () => {
    userId = randomUUID();
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.invalid` },
    });
    id = (
      await prisma.datingPerson.create({
        data: {
          userId,
          name: "Robin",
          notes: "We had dinner. I want another date.",
        },
      })
    ).id;
    model.call
      .mockReset()
      .mockResolvedValue({ summary: "A second date would be welcome." });
  });
  afterEach(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });
  afterAll(() => prisma.$disconnect());
  it("refreshes notes with no messages and skips only an identical complete fingerprint", async () => {
    expect(
      await refreshDatingInsights(userId, id, { onlyIfStale: true }),
    ).toMatchObject({ refreshed: true });
    expect(
      await refreshDatingInsights(userId, id, { onlyIfStale: true }),
    ).toMatchObject({ refreshed: false, reason: "fresh" });
    expect(model.call).toHaveBeenCalledTimes(1);
    await updateWithIdentity(userId, id, { notes: "Now I am unsure." });
    expect(
      await refreshDatingInsights(userId, id, { onlyIfStale: true }),
    ).toMatchObject({ refreshed: true });
    expect(model.call).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent generation and refuses stale source output", async () => {
    let finish!: (v: unknown) => void;
    let started!: () => void;
    const ready = new Promise<void>((r) => (started = r));
    model.call.mockImplementationOnce(() => {
      started();
      return new Promise((r) => (finish = r));
    });
    const first = refreshDatingInsights(userId, id);
    await ready;
    const second = await refreshDatingInsights(userId, id);
    expect(second).toMatchObject({ refreshed: false, reason: "in_progress" });
    expect(model.call).toHaveBeenCalledTimes(1);
    await updateWithIdentity(userId, id, {
      notes: "Corrected journal context.",
    });
    finish({ summary: "Old now withdrawn context" });
    expect(await first).toMatchObject({
      refreshed: false,
      reason: "superseded",
    });
    expect(
      (await prisma.datingPerson.findUniqueOrThrow({ where: { id } })).insights,
    ).toBeNull();
  });
  it("releases a failed model lease and preserves original notes", async () => {
    model.call.mockRejectedValueOnce(Error("private payload"));
    expect(await refreshDatingInsights(userId, id)).toMatchObject({
      ok: false,
      status: 502,
    });
    expect(await refreshDatingInsights(userId, id)).toMatchObject({
      refreshed: true,
    });
    expect(
      (await prisma.datingPerson.findUniqueOrThrow({ where: { id } })).notes,
    ).toContain("dinner");
  });
});
