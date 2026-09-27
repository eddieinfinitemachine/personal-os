import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const claude = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: claude.call }));

import { prisma } from "@/lib/prisma";
import { addSuggestion, applyProposedPerson, fileDatingNote, fileGranolaMeeting, linkSuggestion, loadKnownPeople, loadKnownPerson } from "@/lib/dating-filer";

// Opt in explicitly. Never allow the application's normal database connection.
const enabled = process.env.RUN_DATING_IDENTITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.port !== "55441" || url.pathname !== "/dating_matching") {
    throw new Error("Identity integration tests require the local dating_matching scratch database on port 55441");
  }
}

// The external model is the only mock: roster reads, proposal validation,
// identity guarding, suggestions and filing all use the real implementation.
describe.skipIf(!enabled)("date-aware dating identities with real Postgres", () => {
  let userId: string;
  let otherUserId: string;
  let olderId: string;
  let laterId: string;
  let foreignId: string;
  const noteDay = "2026-01-15";
  const meeting = () => ({
    meetingId: `identity-${randomUUID()}`,
    occurredAt: new Date(`${noteDay}T15:00:00Z`),
    title: "Therapy",
    url: null,
    text: "Margo and I had dinner last night. She likes jazz and plans the next date.",
  });
  const item = (personId: string | null, name = "Margo") => ({
    personId, name, matchDate: noteDay, isNew: personId === null,
    summary: "Dinner and plans", note: "I had dinner with Margo. She likes jazz and plans the next date.",
    remember: ["Likes jazz"], greenFlags: ["Plans the next date"], stage: "exclusive",
    events: [{ kind: "date", title: "Dinner together", occurredAt: "2026-01-14", vibe: null }],
  });
  const ownedPeople = () => prisma.datingPerson.findMany({ where: { userId }, orderBy: { id: "asc" } });

  beforeEach(async () => {
    claude.call.mockReset();
    userId = `identity-regression-${randomUUID()}`;
    otherUserId = `identity-regression-${randomUUID()}`;
    await prisma.user.createMany({ data: [userId, otherUserId].map((id) => ({ id, email: `${id}@example.invalid` })) });
    olderId = (await prisma.datingPerson.create({ data: {
      userId, name: "Margot", stage: "ended", metAt: new Date("2024-01-01T12:00:00Z"),
      endedAt: new Date("2025-06-01T12:00:00Z"), remember: ["Likes jazz"],
    } })).id;
    laterId = (await prisma.datingPerson.create({ data: {
      userId, name: "Margaux", stage: "dating", metAt: new Date("2025-11-01T12:00:00Z"), remember: ["Likes walks"],
    } })).id;
    foreignId = (await prisma.datingPerson.create({ data: {
      userId: otherUserId, name: "Foreign private person", stage: "dating",
    } })).id;
  });
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("loads full non-note activity bounds beyond the ten displayed events, scoped to the owner", async () => {
    await prisma.datingEvent.createMany({ data: [
      ...Array.from({ length: 15 }, (_, month) => ({
        userId, personId: olderId, kind: "date", title: `Date ${month + 1}`,
        occurredAt: new Date(Date.UTC(2024, month, 15, 12)),
      })),
      { userId, personId: olderId, kind: "note", title: "Imported old recollection", source: "granola", occurredAt: new Date("2020-01-01T12:00:00Z") },
      { userId, personId: olderId, kind: "note", title: "Imported recent recollection", source: "granola", occurredAt: new Date("2026-09-26T12:00:00Z") },
      { userId, personId: laterId, kind: "note", title: "Only a note", source: "granola", occurredAt: new Date("2026-01-15T12:00:00Z") },
      { userId: otherUserId, personId: foreignId, kind: "date", title: "Private date", occurredAt: new Date("2010-01-01T12:00:00Z") },
    ] });
    const people = await loadKnownPeople(userId);
    expect(people.map((p) => p.id).sort()).toEqual([olderId, laterId].sort());
    const older = people.find((p) => p.id === olderId)!;
    expect(older.firstEventAt).toEqual(new Date("2024-01-15T12:00:00Z"));
    expect(older.lastEventAt).toEqual(new Date("2025-03-15T12:00:00Z"));
    expect(older.events).toHaveLength(10);
    expect(older.events!.every((e) => e.kind !== "note")).toBe(true);
    expect(older.events!.some((e) => e.occurredAt.toISOString().startsWith("2024-01-15"))).toBe(false);
    expect(people.find((p) => p.id === laterId)).toMatchObject({ firstEventAt: null, lastEventAt: null, events: [] });
    expect(await loadKnownPerson(userId, olderId)).toEqual(older);
    expect(await loadKnownPerson(userId, foreignId)).toBeNull();
  });

  it("sends both relationship windows and the note date to the model without foreign data", async () => {
    claude.call.mockResolvedValue({ people: [] });
    const note = meeting();
    await fileDatingNote({ userId, text: note.text, occurredAt: note.occurredAt, source: "granola", sourceLabel: note.title });
    expect(claude.call).toHaveBeenCalledTimes(1);
    const prompt = claude.call.mock.calls[0][0].user as string;
    expect(prompt).toContain(`id ${olderId}: Margot`);
    expect(prompt).toContain("activity window: 2024-01-01 → 2025-06-01");
    expect(prompt).toContain(`id ${laterId}: Margaux`);
    expect(prompt).toContain("activity window: 2025-11-01 → unknown end");
    expect(prompt).toMatch(/The note is from \w+ 2026-01-15\./);
    expect(prompt).toContain(note.text);
    expect(prompt).not.toContain(foreignId);
    expect(prompt).not.toContain("Foreign private person");
  });

  it("demotes a wrong owned ID to a suggestion and changes neither person", async () => {
    claude.call.mockResolvedValue({ people: [item(olderId, "Margot")] });
    const before = await ownedPeople();
    const result = await fileGranolaMeeting(userId, meeting());
    expect(result).toMatchObject({ status: "done", filed: [], suggestions: [{ name: "Margot" }] });
    expect(await ownedPeople()).toEqual(before);
    expect(await prisma.datingEvent.count({ where: { userId } })).toBe(0);
    const suggestions = await prisma.datingSuggestion.findMany({ where: { userId, status: "pending" } });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ name: "Margot", personId: null, note: expect.stringContaining("likes jazz") });
    expect(await prisma.datingPerson.count({ where: { userId } })).toBe(2);
  });

  it("files a supported January 2026 match on the later Margaux only", async () => {
    claude.call.mockResolvedValue({ people: [item(laterId)] });
    const olderBefore = await prisma.datingPerson.findUniqueOrThrow({ where: { id: olderId } });
    const result = await fileGranolaMeeting(userId, meeting());
    expect(result).toMatchObject({ status: "done", filed: [{ personId: laterId, name: "Margaux" }], suggestions: [] });
    expect(await prisma.datingPerson.findUniqueOrThrow({ where: { id: olderId } })).toEqual(olderBefore);
    expect(await prisma.datingPerson.findUniqueOrThrow({ where: { id: laterId } })).toMatchObject({
      remember: ["Likes walks", "Likes jazz"], greenFlags: ["Plans the next date"], stage: "exclusive",
    });
    const events = await prisma.datingEvent.findMany({ where: { userId }, orderBy: { occurredAt: "asc" } });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.personId === laterId)).toBe(true);
    expect(events[0]).toMatchObject({ kind: "date", occurredAt: new Date("2026-01-14T12:00:00Z") });
    expect(events[1]).toMatchObject({ kind: "note", occurredAt: new Date("2026-01-15T12:00:00Z") });
    expect(await prisma.datingSuggestion.count({ where: { userId, status: "pending" } })).toBe(0);
  });

  it("keeps a null-ID exact-name abstention as a suggestion when windows overlap", async () => {
    await prisma.datingPerson.update({ where: { id: olderId }, data: { endedAt: new Date("2026-03-01T12:00:00Z") } });
    claude.call.mockResolvedValue({ people: [item(null, "Margot")] });
    const before = await ownedPeople();
    const result = await fileGranolaMeeting(userId, meeting());
    expect(result).toMatchObject({ status: "done", filed: [], suggestions: [{ name: "Margot" }] });
    expect(await ownedPeople()).toEqual(before);
    expect(await prisma.datingEvent.count({ where: { userId } })).toBe(0);
    expect(await prisma.datingSuggestion.findFirst({ where: { userId, status: "pending" } })).toMatchObject({ name: "Margot", personId: null });
  });

  it("preserves an explicitly forced person even if the model selects the similarly named person", async () => {
    claude.call.mockResolvedValue({ people: [item(laterId)] });
    const note = meeting();
    const { proposal, day } = await fileDatingNote({
      userId, personId: olderId, text: note.text, occurredAt: note.occurredAt, source: "granola",
    });
    const prompt = claude.call.mock.calls[0][0].user as string;
    expect(prompt).toContain(`This note is about Margot (id ${olderId}). Attribute everything to her`);
    expect(proposal.people).toHaveLength(1);
    expect(proposal.people[0]).toMatchObject({ personId: olderId, name: "Margot", isNew: false });
    const laterBefore = await prisma.datingPerson.findUniqueOrThrow({ where: { id: laterId } });
    const applied = await applyProposedPerson(userId, proposal.people[0], { day, source: "granola" });
    expect(applied).toMatchObject({ personId: olderId, created: false });
    expect(await prisma.datingEvent.count({ where: { userId, personId: olderId } })).toBe(2);
    expect(await prisma.datingEvent.count({ where: { userId, personId: laterId } })).toBe(0);
    expect(await prisma.datingPerson.findUniqueOrThrow({ where: { id: laterId } })).toEqual(laterBefore);
  });

  it.each(["link", "add"] as const)("%s consumes only the selected Margo suggestion, retaining a later same-name suggestion", async (action) => {
    const earlier = await prisma.datingSuggestion.create({ data: {
      userId, name: "Margo", meetingId: "earlier-margo", occurredAt: new Date("2025-01-15T12:00:00Z"),
      summary: "Earlier relationship", note: "An earlier Margo memory.",
    } });
    const later = await prisma.datingSuggestion.create({ data: {
      userId, name: "Margo", meetingId: "later-margo", occurredAt: new Date("2026-01-15T12:00:00Z"),
      summary: "Later relationship", note: "A later Margo memory.",
    } });
    const result = action === "link"
      ? await linkSuggestion(userId, earlier.id, olderId)
      : await addSuggestion(userId, earlier.id);
    expect(result).not.toBeNull();
    expect(result!.filed).toBe(1);
    expect(await prisma.datingSuggestion.findUniqueOrThrow({ where: { id: earlier.id } }))
      .toMatchObject({ status: "added", personId: result!.person.id });
    expect(await prisma.datingSuggestion.findUniqueOrThrow({ where: { id: later.id } })).toEqual(later);
    const events = await prisma.datingEvent.findMany({ where: { userId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ personId: result!.person.id, occurredAt: earlier.occurredAt, notes: expect.stringContaining(earlier.note) });
    expect(events[0].notes).not.toContain(later.note);
    const again = action === "link"
      ? await linkSuggestion(userId, earlier.id, laterId)
      : await addSuggestion(userId, earlier.id);
    expect(again).toBeNull();
    expect(await prisma.datingPerson.count({ where: { userId } })).toBe(action === "add" ? 3 : 2);
  });

  it("allows only one concurrent link of a suggestion to two different people", async () => {
    const suggestion = await prisma.datingSuggestion.create({ data: {
      userId, name: "Margo", meetingId: "race-margo", occurredAt: new Date("2026-01-15T12:00:00Z"),
      summary: "One ambiguous meeting", note: "This note must be attributed once.",
    } });
    // Hold the selected row so both real transactions reach the status update
    // together. Without the conditional claim, both can read "pending" first.
    let signalLocked!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "DatingSuggestion" WHERE id = ${suggestion.id} FOR UPDATE`;
      signalLocked();
      await released;
    }, { timeout: 10_000 });
    await locked;
    const linking = Promise.all([
      linkSuggestion(userId, suggestion.id, olderId),
      linkSuggestion(userId, suggestion.id, laterId),
    ]);
    let attempts: Array<Awaited<typeof linking>[number]> = [];
    try {
      await expect.poll(async () => {
        const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%UPDATE%DatingSuggestion%'
        `;
        return row.waiting;
      }, { interval: 10, timeout: 2000 }).toBeGreaterThanOrEqual(2);
    } finally {
      release();
      await blocker;
      attempts = await linking;
    }
    const winners = attempts.filter((value) => value !== null);
    expect(winners).toHaveLength(1);
    const stored = await prisma.datingSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
    expect(stored).toMatchObject({ status: "added", personId: winners[0]!.person.id });
    const events = await prisma.datingEvent.findMany({ where: { userId } });
    expect(events).toHaveLength(1);
    expect(events[0].personId).toBe(stored.personId);
    expect(await prisma.datingPerson.count({ where: { userId } })).toBe(2);
  });
});
