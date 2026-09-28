import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { syncGranolaIntake } from "./granola";
import { processSource } from "./extract";
import type { GranolaNote } from "../granola";
const enabled = process.env.RUN_DATING_INTAKE_INTEGRATION === "1";
if (enabled) { const url = new URL(process.env.DATABASE_URL ?? "http://invalid"); if (url.hostname !== "127.0.0.1" || url.port !== "55442" || url.pathname !== "/dating_intake") throw new Error("Scratch database required"); }
const note = (id: string): GranolaNote => ({ id, title: "Synthetic session", owner: { name: "Synthetic owner", email: "synthetic@example.invalid" }, created_at: "2026-09-27T12:00:00Z", updated_at: "2026-09-27T12:00:00Z", web_url: "https://example.invalid/note", calendar_event: null, attendees: [], summary_text: "A fictional source note", summary_markdown: null, private_notes_text: null, private_notes_markdown: null, transcript: [{ speaker: { source: "microphone" }, text: "Robin and I planned another date." }] });
describe.skipIf(!enabled)("Granola adapter against scratch Postgres", () => {
  let userId: string; let stateId: string;
  beforeEach(async () => { userId = randomUUID(); await prisma.user.create({ data: { id: userId, email: `${userId}@example.invalid` } }); stateId = (await prisma.datingSourceState.create({ data: { userId, source: "granola", enabled: true } })).id; });
  afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
  afterAll(() => prisma.$disconnect());
  const client = (items: GranolaNote[]) => ({ listNotes: vi.fn(), listNotesPage: vi.fn().mockResolvedValue({ notes: items, hasMore: false, cursor: null }), getNote: vi.fn(async (id: string) => items.find((item) => item.id === id)!) });

  it("keeps received backlog durable across runs and avoids reclassifying unchanged no-result revisions", async () => {
    const items = Array.from({ length: 7 }, (_, index) => note(`synthetic-${index}`));
    const remote = client(items);
    expect(await syncGranolaIntake(userId, stateId, { client: remote })).toMatchObject({ attempted: 6, remaining: 1, complete: false });
    const before = await prisma.datingSourceState.findUniqueOrThrow({ where: { id: stateId } });
    expect(before.lastSuccessAt).toBeNull(); expect(before.backlog).toBeGreaterThan(0);
    expect(await syncGranolaIntake(userId, stateId, { client: remote })).toMatchObject({ attempted: 1, remaining: 0, complete: true });
    const extract = vi.fn(async () => ({ mentions: [] }));
    await processSource(userId, stateId, { extract });
    expect(extract).toHaveBeenCalledTimes(7);
    const complete = await prisma.datingSourceState.findUniqueOrThrow({ where: { id: stateId } });
    expect(complete.lastSuccessAt).not.toBeNull(); expect(complete.backlog).toBe(0);
    await syncGranolaIntake(userId, stateId, { client: remote });
    await processSource(userId, stateId, { extract });
    expect(extract).toHaveBeenCalledTimes(7);
  });

  it("baselines already-filed legacy notes without extracting them, then accepts an edited revision", async () => {
    const original = note("legacy"); const remote = client([original]);
    await prisma.datingSuggestion.create({ data: { userId, name: "(filing complete)", meetingId: original.id, summary: "", note: "", occurredAt: new Date(original.created_at), status: "dismissed" } });
    await syncGranolaIntake(userId, stateId, { client: remote });
    const baseline = await prisma.datingSourceRecord.findFirstOrThrow({ where: { stateId } });
    expect(baseline.status).toBe("processed"); expect(baseline.payload).toBeNull();
    const extract = vi.fn(async () => ({ mentions: [] }));
    await processSource(userId, stateId, { extract }); expect(extract).not.toHaveBeenCalled();
    await syncGranolaIntake(userId, stateId, { client: remote });
    expect(await prisma.datingSourceRecord.count({ where: { stateId } })).toBe(1);
    original.transcript![0].text = "Robin and I planned a different date.";
    await syncGranolaIntake(userId, stateId, { client: remote });
    const current = await prisma.datingSourceRecord.findFirstOrThrow({ where: { stateId, status: "pending" } });
    expect(current.documentVersion).toBe(2); expect(current.revision).not.toBe(baseline.revision);
    await processSource(userId, stateId, { extract }); expect(extract).toHaveBeenCalledOnce();
  });

  it("rejects another owner's source and respects pause", async () => {
    const remote = client([note("n")]);
    expect(await syncGranolaIntake("other-owner", stateId, { client: remote })).toMatchObject({ skipped: true });
    expect(remote.listNotesPage).not.toHaveBeenCalled();
    await prisma.datingSourceState.update({ where: { id: stateId }, data: { enabled: false } });
    expect(await syncGranolaIntake(userId, stateId, { client: remote })).toMatchObject({ skipped: true });
    expect(remote.listNotesPage).not.toHaveBeenCalled();
  });
});
