import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const model = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: model.call }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
import { prisma } from "./prisma";
import { refreshDatingInsights } from "./dating-insights";
import { POST } from "@/app/api/capture/dating/insights/route";
import { GET as readInsights } from "@/app/api/dating/[id]/insights/route";

const enabled = process.env.RUN_DATING_INSIGHTS_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55441" || url.pathname !== "/dating_natural_add") {
    throw new Error("Insight integration tests require the local dating_natural_add scratch database on55441");
  }
}

describe.skipIf(!enabled)("automatic dating insights with real PostgreSQL", () => {
  let userId: string;
  let personId: string;
  const start = new Date("2026-09-27T10:00:00Z");
  const old = new Date("2026-09-26T10:00:00Z");
  const token = "insight-regression-token";
  const message = (extra = {}) => prisma.datingMessage.create({ data: {
    userId, personId, externalId: randomUUID(), fromMe: false, text: "Coffee at Birch on Friday?",
    sentAt: old, createdAt: old, source: "imessage", ...extra,
  } });
  const capture = (id = personId, bearer = token) => POST(new Request("http://localhost/api/capture/dating/insights", {
    method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ personId: id }),
  }));
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    userId = `insight-regression-${randomUUID()}`;
    const email = `${userId}@example.invalid`;
    vi.stubEnv("CAPTURE_TOKEN", token);
    vi.stubEnv("CAPTURE_TOKENS", "{}");
    vi.stubEnv("FOUNDER_EMAIL", email);
    await prisma.user.create({ data: { id: userId, email } });
    personId = (await prisma.datingPerson.create({ data: {
      userId, name: "Regression Person", notes: "Keep this original note", remember: ["Manually remembered"],
      greenFlags: ["Manual green"], redFlags: ["Manual red"], lessons: "Manual lessons", stage: "dating",
    } })).id;
    model.call.mockReset().mockResolvedValue({ summary: "Coffee is planned.", remember: ["Likes Birch"], lessons: "Derived lesson", ideas: ["Confirm Friday"] });
  });
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("uses capture auth and rejects a person belonging to another account", async () => {
    expect((await capture(personId, "invalid")).status).toBe(401);
    const foreign = await prisma.user.create({ data: { email: `foreign-${randomUUID()}@example.invalid` } });
    try {
      const person = await prisma.datingPerson.create({ data: { userId: foreign.id, name: "Foreign" } });
      expect((await capture(person.id)).status).toBe(404);
    } finally { await prisma.user.delete({ where: { id: foreign.id } }); }
    expect(model.call).not.toHaveBeenCalled();
  });

  it("reads only saved owner-scoped insight fields without generating", async () => {
    await prisma.datingPerson.update({ where: { id: personId }, data: { insights: { summary: "Saved" }, insightsAt: start } });
    const read = (owner?: string) => readInsights(new Request("http://localhost/api/dating/p/insights", { headers: owner ? { "x-user-id": owner } : {} }), { params: Promise.resolve({ id: personId }) });
    expect((await read()).status).toBe(401);
    expect((await read("different-owner")).status).toBe(404);
    const response = await read(userId);
    expect(await response.json()).toEqual({ insights: { summary: "Saved" }, insightsAt: start.toISOString() });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(model.call).not.toHaveBeenCalled();
  });

  it("refreshes null insights and reports coverage without overwriting manual fields", async () => {
    await message();
    await message({ source: "whatsapp", fromMe: true });
    const res = await capture();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ refreshed: true, sources: {
      messageCount: 2, analyzedMessageCount: 2, messageSources: { imessage: 1, whatsapp: 1 }, hasNotes: true,
    } });
    const row = await prisma.datingPerson.findUniqueOrThrow({ where: { id: personId } });
    expect(row).toMatchObject({ notes: "Keep this original note", remember: ["Manually remembered"],
      greenFlags: ["Manual green"], redFlags: ["Manual red"], lessons: "Manual lessons", stage: "dating",
      insights: { summary: "Coffee is planned.", sources: {
        messageCount: 2, analyzedMessageCount: 2, messageSources: { imessage: 1, whatsapp: 1 },
        analyzedMessageSources: { imessage: 1, whatsapp: 1 }, timelineCount: 0, hasNotes: true,
      } }, insightsAt: start });
    expect(model.call.mock.calls[0][0].user).toContain("imessage: 1 messages; whatsapp: 1 messages");
  });

  it("migrates summaries without fingerprints, skips covered inputs, and refreshes historic backfill", async () => {
    await message();
    await prisma.datingPerson.update({ where: { id: personId }, data: { insights: { summary: "Previous" }, insightsAt: start } });
    expect(await (await capture()).json()).toMatchObject({ refreshed: true });
    const migrated = await prisma.datingPerson.findUniqueOrThrow({ where: { id: personId } });
    const fingerprint = (migrated.insights as { sourceFingerprint: string }).sourceFingerprint;
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    model.call.mockClear();
    expect(await (await capture()).json()).toMatchObject({ refreshed: false, reason: "fresh" });
    expect(model.call).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(start.getTime() + 2000));
    await message({ sentAt: new Date("2020-01-01"), createdAt: new Date(start.getTime() + 1000), text: "Historic backfill evidence" });
    expect(await (await capture()).json()).toMatchObject({ refreshed: true });
    expect(model.call.mock.calls[0][0].user).toContain("Historic backfill evidence");
    const backfilled = await prisma.datingPerson.findUniqueOrThrow({ where: { id: personId } });
    expect((backfilled.insights as { sourceFingerprint: string }).sourceFingerprint).not.toBe(fingerprint);
  });

  it("persists actual analyzed source counts separately when the newest-message budget truncates a thread", async () => {
    await message({ source: "whatsapp", sentAt: new Date("2020-01-01") });
    await prisma.datingMessage.createMany({ data: Array.from({ length: 3000 }, (_, i) => ({
      userId, personId, externalId: `${personId}-coverage-${i}`, fromMe: false,
      text: "Synthetic coverage message with enough text to exercise the prompt limit.",
      source: "imessage", sentAt: old, createdAt: old,
    })) });
    await capture();
    const saved = await prisma.datingPerson.findUniqueOrThrow({ where: { id: personId } });
    const sources = (saved.insights as { sources: { messageCount: number; analyzedMessageCount: number; messageSources: Record<string, number>; analyzedMessageSources: Record<string, number> } }).sources;
    expect(sources.messageCount).toBe(3001);
    expect(sources.messageSources).toEqual({ imessage: 3000, whatsapp: 1 });
    expect(sources.analyzedMessageCount).toBeGreaterThan(0);
    expect(sources.analyzedMessageCount).toBeLessThan(3000);
    expect(sources.analyzedMessageSources).toEqual({ imessage: sources.analyzedMessageCount });
  });

  it("preserves prior summary and imported messages on failure, then retries without another import", async () => {
    await message();
    await prisma.datingPerson.update({ where: { id: personId }, data: { insights: { summary: "Previous" }, insightsAt: new Date("2020-01-01") } });
    model.call.mockRejectedValueOnce(new Error("raw provider secret"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await capture();
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toContain("raw provider");
    const beforeRetry = await prisma.datingPerson.findUniqueOrThrow({ where: { id: personId } });
    expect(beforeRetry.insights).toEqual({ summary: "Previous" });
    expect(beforeRetry.insightsAt).toEqual(new Date("2020-01-01"));
    expect(await prisma.datingMessage.count({ where: { personId } })).toBe(1);
    expect(await (await capture()).json()).toMatchObject({ refreshed: true });
  });

  it("keeps imports arriving during generation stale until the next refresh", async () => {
    await message();
    model.call.mockImplementationOnce(async () => {
      await message({ text: "Arrived during generation", createdAt: new Date(start.getTime() + 1000) });
      vi.setSystemTime(new Date(start.getTime() + 2000));
      return { summary: "First read" };
    });
    await capture();
    expect((await prisma.datingPerson.findUniqueOrThrow({ where: { id: personId } })).insightsAt).toEqual(start);
    expect(await (await capture()).json()).toMatchObject({ refreshed: true });
    expect(model.call).toHaveBeenCalledTimes(2);
  });

  it("does not mark malformed model output as a successful summary", async () => {
    await message();
    model.call.mockResolvedValueOnce({ remember: ["No summary was returned"] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await capture()).status).toBe(502);
    expect((await prisma.datingPerson.findUniqueOrThrow({ where: { id: personId } })).insightsAt).toBeNull();
    expect(await (await capture()).json()).toMatchObject({ refreshed: true });
  });

  it("coalesces a concurrent refresh into the active generation", async () => {
    await message();
    model.call.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(start.getTime() + 1000));
      expect(await refreshDatingInsights(userId, personId)).toMatchObject({
        ok: true, refreshed: false, reason: "in_progress",
      });
      return { summary: "Shared read" };
    });
    expect(await (await capture()).json()).toMatchObject({ refreshed: true });
    expect(model.call).toHaveBeenCalledTimes(1);
    const saved = await prisma.datingPerson.findUniqueOrThrow({ where: { id: personId } });
    expect(saved.insights).toMatchObject({ summary: "Shared read" });
    expect(saved.insights).not.toHaveProperty("generation");
    expect(await (await capture()).json()).toMatchObject({ refreshed: false, reason: "fresh" });
    expect(model.call).toHaveBeenCalledTimes(1);
  });

  it("does not let an in-flight read replace a profile changed during generation", async () => {
    await message();
    const newer = new Date(start.getTime() + 1000);
    model.call.mockImplementationOnce(async () => {
      await prisma.datingPerson.update({ where: { id: personId }, data: {
        notes: "New manual note", insights: { summary: "Newer saved summary" },
        insightsAt: newer, updatedAt: newer,
      } });
      return { summary: "Older read" };
    });
    expect(await (await capture()).json()).toMatchObject({ refreshed: false, reason: "superseded" });
    expect(await prisma.datingPerson.findUniqueOrThrow({ where: { id: personId } })).toMatchObject({
      notes: "New manual note", insights: { summary: "Newer saved summary" }, insightsAt: newer,
    });
  });

  it("automatically summarizes notes without messages and skips only unchanged inputs", async () => {
    expect(await (await capture()).json()).toMatchObject({ refreshed: true, sources: { messageCount: 0, hasNotes: true } });
    expect(model.call.mock.calls[0][0].user).toContain("Keep this original note");
    expect(await (await capture()).json()).toMatchObject({ refreshed: false, reason: "fresh" });
    expect(model.call).toHaveBeenCalledTimes(1);
    await prisma.datingPerson.update({ where: { id: personId }, data: { notes: "Changed manual note" } });
    expect(await (await capture()).json()).toMatchObject({ refreshed: true });
    expect(model.call.mock.calls[1][0].user).toContain("Changed manual note");
    expect(await refreshDatingInsights(userId, personId)).toMatchObject({ ok: true, refreshed: true });
    expect(model.call).toHaveBeenCalledTimes(3);
  });
});
