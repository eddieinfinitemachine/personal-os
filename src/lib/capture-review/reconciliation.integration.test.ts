import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/prisma", () => ({ get prisma() { if (!state.db) throw new Error("Test database not initialized"); return state.db; } }));
import { commitCore } from "./commit";
import { correctCaptureReview } from "./correct";
import { readEffects } from "./journal";
import { withCaptureReview } from "./record";

const databaseUrl = process.env.CAPTURE_REVIEW_TEST_DATABASE_URL;
const users: string[] = [];

describe.skipIf(!databaseUrl)("capture interaction reconciliation — real Postgres", () => {
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/capture_review_test")) throw new Error("Integration tests require the isolated local scratch database");
    state.db = new PrismaClient({ datasourceUrl: databaseUrl });
  });
  afterAll(async () => {
    if (state.db) { await state.db.user.deleteMany({ where: { id: { in: users } } }); await state.db.$disconnect(); }
  });

  it("preserves a concurrent ordinary person-date edit when the capture never changed that person", async () => {
    const original = state.db!;
    const userId = `capture-review-person-race-${randomUUID()}`, reviewId = randomUUID();
    await original.user.create({ data: { id: userId, email: `${userId}@example.test` } });
    users.push(userId);
    const person = await original.person.create({ data: { userId, firstName: "Synthetic", lastName: "Contact", lastInteractionAt: new Date("2026-01-01T12:00:00Z") } });
    const proposal = { type: "interaction" as const, title: "Older captured encounter", kind: "meeting" as const, occurredAt: "2025-12-01T12:00:00Z", personHints: [{ firstName: person.firstName, lastName: person.lastName }] };
    await withCaptureReview({ id: reviewId, userId, source: "web", requestHash: "synthetic-race", input: { text: "Older captured encounter", url: null, files: [] }, proposal }, {
      commit: async tx => ({ value: null, placement: await commitCore(tx, userId, { text: "Older captured encounter", url: null }, proposal, [], { mode: "web" }) }),
      replay: async () => null,
    });
    const review = await original.captureReview.findUniqueOrThrow({ where: { id: reviewId } });
    expect(readEffects(review.effects)!.writes.some(effect => effect.model === "person")).toBe(false);
    // EC Pad activities can add a surviving encounter without changing the
    // person's manually editable date. Reconciliation will need to advance it.
    await original.interaction.create({ data: { userId, title: "Surviving EC Pad encounter", kind: "meeting", source: "ecpad", occurredAt: new Date("2026-03-01T12:00:00Z"), personIds: [person.id] } });

    let announceRead!: () => void, releaseRead!: () => void;
    const personRead = new Promise<void>(resolve => { announceRead = resolve; });
    const resumeRead = new Promise<void>(resolve => { releaseRead = resolve; });
    let paused = false;
    // Pause immediately after the real database read, so an ordinary writer
    // either finishes before the stale write or waits for the correction lock.
    state.db = original.$extends({ query: { person: { findFirst: async ({ args, query }) => {
      const row = await query(args);
      if (!paused && args.where?.id === person.id) { paused = true; announceRead(); await resumeRead; }
      return row;
    } } } }) as unknown as PrismaClient;
    const correction = correctCaptureReview(userId, reviewId, { revision: 1, proposal: { type: "todo", title: "Actually a task" } }).then(value => ({ value, error: null }), error => ({ value: null, error }));
    let ordinary: Promise<unknown> | undefined;
    try {
      await personRead;
      let finished = false;
      ordinary = original.person.update({ where: { id: person.id }, data: { lastInteractionAt: new Date("2026-04-01T12:00:00Z") } }).then(row => { finished = true; return row; });
      let observed = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (finished) { observed = true; break; }
        const waiting = await original.$queryRaw<Array<{ query: string }>>`SELECT query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        if (waiting.some(row => row.query.includes('UPDATE "public"."Person"'))) { observed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(observed).toBe(true);
    } finally {
      releaseRead();
      state.db = original;
      const corrected = await correction;
      await ordinary;
      expect(corrected.error).toBeNull();
    }
    expect((await original.person.findUniqueOrThrow({ where: { id: person.id } })).lastInteractionAt?.toISOString()).toBe("2026-04-01T12:00:00.000Z");
    expect((await original.captureReview.findUniqueOrThrow({ where: { id: reviewId } })).revision).toBe(2);
  });
});
