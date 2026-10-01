import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./extract", () => ({
  extractCallSheetCues: vi.fn().mockResolvedValue([]),
}));
import { prisma } from "@/lib/prisma";
import { captureCallSheet, getCaptureConfig } from "./capture";
import { extractCallSheetCues } from "./extract";
import {
  decideCallSheetReview,
  getCallSheet,
  getCallSheetReview,
  deletePersonWithCallSheetCleanup,
  mutateCallSheet,
  readDay,
  readSourceData,
  setCallSheetReminder,
  updateCallSheetSettings,
} from "./service";
import type { CapturePerson } from "./types";
const enabled = process.env.RUN_CALL_SHEET_INTEGRATION === "1";
if (
  enabled &&
  process.env.DATABASE_URL !==
    "postgresql://postgres@127.0.0.1:55442/dating_intake"
)
  throw new Error(
    "Call sheet integration requires the exact isolated scratch database URL",
  );
const now = new Date("2026-09-28T16:00:00Z");
const ids: string[] = [];
let userId: string;
let otherId: string;
async function seed() {
  const user = await prisma.user.create({
    data: { email: `call-sheet-${crypto.randomUUID()}@example.invalid` },
  });
  ids.push(user.id);
  const people = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      prisma.person.create({
        data: {
          userId: user.id,
          firstName: "Synthetic",
          lastName: `Person${i}`,
          phone: `+15555550${String(i).padStart(3, "0")}`,
          circles: i < 4 ? ["friends"] : i < 6 ? ["family"] : ["work"],
        },
      }),
    ),
  );
  await prisma.interaction.create({
    data: {
      userId: user.id,
      personIds: people.map((person) => person.id),
      occurredAt: new Date("2026-01-01T00:00:00Z"),
      kind: "meeting",
      title: "Synthetic old encounter",
      source: "manual",
    },
  });
  return user.id;
}
async function payload(id = userId): Promise<CapturePerson> {
  const config = await getCaptureConfig(id);
  const person = config.people[0];
  return {
    type: "person",
    source: "imessage",
    sourceEpoch: config.sourceEpochs!.imessage,
    personId: person.id,
    identityKey: person.identityKey,
    handles: [person.phone!],
    capturedAt: now.toISOString(),
    coverageStart: "2025-09-28T16:00:00.000Z",
    lastContactAt: "2026-08-01T12:00:00.000Z",
    messageCount: 1,
    messages: [
      {
        guid: "synthetic-message",
        sentAt: "2026-08-01T12:00:00.000Z",
        fromMe: false,
        text: "Could you tell me about your trip?",
      },
    ],
  };
}
describe.skipIf(!enabled)("call sheet real PostgreSQL", () => {
  beforeEach(async () => {
    userId = await seed();
    otherId = await seed();
    vi.mocked(extractCallSheetCues).mockReset().mockResolvedValue([]);
  });
  afterAll(async () => {
    if (ids.length)
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });
  it("serializes simultaneous initial reads into one stable day", async () => {
    const [one, two, three] = await Promise.all([
      getCallSheet(userId, now),
      getCallSheet(userId, now),
      getCallSheet(userId, now),
    ]);
    expect(one.entries).toHaveLength(5);
    expect(two).toEqual(one);
    expect(three).toEqual(one);
    expect(await prisma.callSheetDay.count({ where: { userId } })).toBe(1);
  });
  it("Done is atomic and idempotent; stale mutations and cross-owner day IDs fail", async () => {
    const sheet = await getCallSheet(userId, now);
    const action = {
      dayId: sheet.day.id,
      version: sheet.day.version,
      entryId: sheet.entries[0].id,
      action: "done",
        method: "call",
    };
    const [a, b] = await Promise.all([
      mutateCallSheet(userId, action, now),
      mutateCallSheet(userId, action, now),
    ]);
    expect(a.entries[0].status).toBe("done");
    expect(b.entries[0].interactionId).toBe(a.entries[0].interactionId);
    expect(
      await prisma.interaction.count({
        where: { userId, source: "call-sheet" },
      }),
    ).toBe(1);
    await expect(
      mutateCallSheet(
        userId,
        { ...action, method: undefined, action: "hide", entryId: sheet.entries[1].id },
        now,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(mutateCallSheet(otherId, action, now)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await prisma.interaction.count({
        where: { userId: otherId, source: "call-sheet" },
      }),
    ).toBe(0);
  });
  it("requires a real reach-out method before writing an interaction", async () => {
    const sheet = await getCallSheet(userId, now);
    const action = { dayId: sheet.day.id, version: sheet.day.version, entryId: sheet.entries[0].id, action: "done" };
    for (const method of [undefined, "", "fax", "constructor", null, {}]) {
      expect(() => mutateCallSheet(userId, { ...action, method }, now)).toThrow("Choose how you reached out");
    }
    expect(await prisma.interaction.count({ where: { userId, source: "call-sheet" } })).toBe(0);
    expect((await getCallSheet(userId, now)).entries[0].status).toBe("pending");
  });
  it("persists each selected method in the timeline and daily row, with exact Undo", async () => {
    const methods = [
      ["call", "call", "Called"], ["text", "message", "Texted"],
      ["whatsapp", "message", "Messaged on WhatsApp:"], ["email", "message", "Emailed"],
      ["in_person", "meeting", "Met with"], ["other", "other", "Checked in with"],
    ];
    for (const [method, kind, title] of methods) {
      const sheet = await getCallSheet(userId, now);
      const done = await mutateCallSheet(userId, { dayId: sheet.day.id, version: sheet.day.version, entryId: sheet.entries[0].id, action: "done", method }, now);
      const saved = await prisma.interaction.findUniqueOrThrow({ where: { id: done.entries[0].interactionId! } });
      expect(saved.kind).toBe(kind);
      expect(saved.title).toBe(`${title} ${sheet.entries[0].name}`);
      const refreshed = await getCallSheet(userId, now);
      expect(refreshed.entries[0].method).toBe(method);
      expect(refreshed.entries[0].reason).toContain("check-in logged today");
      const undone = await mutateCallSheet(userId, { dayId: refreshed.day.id, version: refreshed.day.version, action: "undo", undoToken: refreshed.undoToken }, now);
      expect(undone.entries[0].status).toBe("pending");
      expect(undone.entries[0].method).toBeUndefined();
      expect(await prisma.interaction.findUnique({ where: { id: saved.id } })).toBeNull();
    }
  });
  it("Undo removes only its exact check-in and preserves a newer encounter", async () => {
    const sheet = await getCallSheet(userId, now);
    const done = await mutateCallSheet(
      userId,
      {
        dayId: sheet.day.id,
        version: sheet.day.version,
        entryId: sheet.entries[0].id,
        action: "done",
        method: "call",
      },
      now,
    );
    const personId = sheet.entries[0].personId;
    const later = new Date(now.getTime() + 60_000);
    const encounter = await prisma.interaction.create({
      data: {
        userId,
        personIds: [personId],
        occurredAt: later,
        kind: "call",
        title: "Synthetic later call",
      },
    });
    await prisma.person.update({
      where: { id: personId },
      data: { lastInteractionAt: later },
    });
    const refreshed = await getCallSheet(userId, later);
    const undone = await mutateCallSheet(
      userId,
      {
        dayId: done.day.id,
        version: refreshed.day.version,
        action: "undo",
        undoToken: done.undoToken,
      },
      later,
    );
    expect(undone.undoToken).toBeUndefined();
    expect(
      await prisma.interaction.findUnique({ where: { id: encounter.id } }),
    ).not.toBeNull();
    expect(
      await prisma.interaction.count({
        where: { userId, source: "call-sheet" },
      }),
    ).toBe(0);
    expect(
      (await prisma.person.findUniqueOrThrow({ where: { id: personId } }))
        .lastInteractionAt,
    ).toEqual(later);
  });
  it("Replace changes only one slot and only the latest action can be undone", async () => {
    const sheet = await getCallSheet(userId, now);
    const first = await mutateCallSheet(
      userId,
      {
        dayId: sheet.day.id,
        version: sheet.day.version,
        entryId: sheet.entries[2].id,
        action: "replace",
      },
      now,
    );
    expect(first.entries[2].personId).not.toBe(sheet.entries[2].personId);
    for (const index of [0, 1, 3, 4])
      expect(first.entries[index].id).toBe(sheet.entries[index].id);
    const second = await mutateCallSheet(
      userId,
      {
        dayId: first.day.id,
        version: first.day.version,
        entryId: first.entries[0].id,
        action: "snooze",
        days: 14,
      },
      now,
    );
    await expect(
      mutateCallSheet(
        userId,
        {
          dayId: second.day.id,
          version: second.day.version,
          action: "undo",
          undoToken: first.undoToken,
        },
        now,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const undone = await mutateCallSheet(
      userId,
      {
        dayId: second.day.id,
        version: second.day.version,
        action: "undo",
        undoToken: second.undoToken,
      },
      now,
    );
    expect(undone.entries.map((entry) => entry.id)).toEqual(
      first.entries.map((entry) => entry.id),
    );
  });
  it("Replace with nobody else due keeps the person; snooze still removes them", async () => {
    const sheet = await getCallSheet(userId, now);
    await prisma.person.updateMany({
      where: {
        userId,
        id: { notIn: sheet.entries.map((entry) => entry.personId) },
      },
      data: { archived: true },
    });
    const target = sheet.entries[2];
    await expect(
      mutateCallSheet(
        userId,
        {
          dayId: sheet.day.id,
          version: sheet.day.version,
          entryId: target.id,
          action: "replace",
        },
        now,
      ),
    ).rejects.toMatchObject({ status: 422 });
    const kept = await getCallSheet(userId, now);
    expect(kept.entries.map((entry) => entry.id)).toEqual(
      sheet.entries.map((entry) => entry.id),
    );
    expect(kept.undoToken).toBeUndefined();
    expect(
      await prisma.callSheetContact.findUnique({
        where: { userId_personId: { userId, personId: target.personId } },
      }),
    ).toMatchObject({ snoozedUntil: null });
    const snoozed = await mutateCallSheet(
      userId,
      {
        dayId: kept.day.id,
        version: kept.day.version,
        entryId: target.id,
        action: "snooze",
        days: 7,
      },
      now,
    );
    expect(snoozed.entries.map((entry) => entry.id)).toEqual(
      sheet.entries
        .filter((entry) => entry.id !== target.id)
        .map((entry) => entry.id),
    );
  });
  it("rechecks JSON entry ownership, archive state, and identity before returning", async () => {
    const sheet = await getCallSheet(userId, now);
    const day = await prisma.callSheetDay.findUniqueOrThrow({
      where: { id: sheet.day.id },
    });
    const data = readDay(day.entries);
    const foreign = await prisma.person.findFirstOrThrow({
      where: { userId: otherId },
    });
    data.entries[0].personId = foreign.id;
    await prisma.callSheetDay.update({
      where: { id: day.id },
      data: { entries: JSON.parse(JSON.stringify(data)) },
    });
    await prisma.person.update({
      where: { id: sheet.entries[1].personId },
      data: { archived: true },
    });
    await prisma.person.update({
      where: { id: sheet.entries[2].personId },
      data: { firstName: "Changed" },
    });
    const fresh = await getCallSheet(userId, now);
    expect(
      fresh.entries.some((entry) =>
        [
          foreign.id,
          sheet.entries[1].personId,
          sheet.entries[2].personId,
        ].includes(entry.personId),
      ),
    ).toBe(false);
  });
  it("hide/restore and cadence settings remain owner scoped", async () => {
    const sheet = await getCallSheet(userId, now);
    const hidden = await mutateCallSheet(
      userId,
      {
        dayId: sheet.day.id,
        version: sheet.day.version,
        entryId: sheet.entries[0].id,
        action: "hide",
      },
      now,
    );
    expect(hidden.hidden).toContainEqual({
      personId: sheet.entries[0].personId,
      name: sheet.entries[0].name,
    });
    const restored = await updateCallSheetSettings(
      userId,
      {
        restorePersonId: sheet.entries[0].personId,
        personId: sheet.entries[0].personId,
        cadenceDays: 45,
      },
      now,
    );
    expect(restored.hidden).toEqual([]);
    await expect(
      updateCallSheetSettings(
        otherId,
        { personId: sheet.entries[0].personId, cadenceDays: 30 },
        now,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("rejects disabled, stale-identity, foreign, conflicting handles and obsolete-epoch capture", async () => {
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: true },
      now,
    );
    const input = await payload();
    await expect(captureCallSheet(otherId, input, now)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      captureCallSheet(userId, { ...input, identityKey: "b".repeat(64) }, now),
    ).rejects.toMatchObject({ status: 409 });
    await prisma.person.create({
      data: { userId, firstName: "Shared", phone: input.handles[0] },
    });
    await expect(captureCallSheet(userId, input, now)).rejects.toMatchObject({
      status: 409,
    });
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: false },
      now,
    );
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: true },
      now,
    );
    await expect(captureCallSheet(userId, input, now)).rejects.toThrow(
      "configuration changed",
    );
  });
  it("saves aggregates on model failure and metadata refresh preserves preferences/cues", async () => {
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: true },
      now,
    );
    const input = await payload();
    await updateCallSheetSettings(
      userId,
      { personId: input.personId, cadenceDays: 45 },
      now,
    );
    vi.mocked(extractCallSheetCues).mockRejectedValueOnce(
      new Error("Synthetic model failure"),
    );
    expect(await captureCallSheet(userId, input, now)).toEqual({
      ok: true,
      extracted: false,
    });
    let contact = await prisma.callSheetContact.findUniqueOrThrow({
      where: { userId_personId: { userId, personId: input.personId } },
    });
    expect(readSourceData(contact.sourceData).imessage).toMatchObject({
      messageCount: 1,
      extractionPending: true,
    });
    expect(contact.cadenceDays).toBe(45);
    const cue = {
      kind: "topic" as const,
      text: "Ask about the trip",
      evidence: [
        {
          source: "imessage" as const,
          messageId: input.messages[0].guid,
          sentAt: input.messages[0].sentAt,
          excerpt: "trip",
        },
      ],
    };
    vi.mocked(extractCallSheetCues).mockResolvedValueOnce([cue]);
    expect((await captureCallSheet(userId, input, now)).extracted).toBe(true);
    await captureCallSheet(
      userId,
      { ...input, messages: [], extract: false },
      now,
    );
    contact = await prisma.callSheetContact.findUniqueOrThrow({
      where: { userId_personId: { userId, personId: input.personId } },
    });
    expect(readSourceData(contact.sourceData).imessage?.cues).toEqual([cue]);
    expect(readSourceData(contact.sourceData).imessage?.extractionPending).toBe(
      false,
    );
    expect(JSON.stringify(contact.sourceData)).not.toContain(
      input.messages[0].text,
    );
  });
  it("does not hold the owner lock during AI and revalidates after source disable", async () => {
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: true },
      now,
    );
    const input = await payload();
    let resolve!: (value: []) => void;
    let started!: () => void;
    const called = new Promise<void>((r) => {
      started = r;
    });
    vi.mocked(extractCallSheetCues).mockImplementationOnce(() => {
      started();
      return new Promise((r) => {
        resolve = r;
      });
    });
    const pending = captureCallSheet(userId, input, now);
    await called;
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: false },
      now,
    );
    resolve([]);
    await expect(pending).rejects.toMatchObject({ status: 409 });
    const contact = await prisma.callSheetContact.findUniqueOrThrow({
      where: { userId_personId: { userId, personId: input.personId } },
    });
    expect(readSourceData(contact.sourceData).imessage).toBeUndefined();
  });
  it("requires complete per-person metadata for global ready and cleans all daily/undo excerpts on disable", async () => {
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: true },
      now,
    );
    const input = await payload();
    const health = {
      type: "health",
      source: "imessage",
      sourceEpoch: input.sourceEpoch,
      status: "ready",
      capturedAt: now.toISOString(),
    };
    await captureCallSheet(
      userId,
      { ...input, messages: [], extract: false },
      now,
    );
    await expect(captureCallSheet(userId, health, now)).rejects.toThrow(
      "incomplete",
    );
    const config = await getCaptureConfig(userId);
    for (const person of config.people)
      await captureCallSheet(
        userId,
        {
          ...input,
          personId: person.id,
          identityKey: person.identityKey,
          handles: [],
          messageCount: 0,
          lastContactAt: null,
          messages: [],
          extract: false,
        },
        now,
      );
    expect(await captureCallSheet(userId, health, now)).toMatchObject({
      ok: true,
    });
    const sheet = await getCallSheet(userId, now);
    const replaced = await mutateCallSheet(
      userId,
      {
        dayId: sheet.day.id,
        version: sheet.day.version,
        entryId: sheet.entries[0].id,
        action: "replace",
      },
      now,
    );
    const day = await prisma.callSheetDay.findUniqueOrThrow({
      where: { id: replaced.day.id },
    });
    const data = readDay(day.entries);
    for (const entry of [...data.entries, ...(data.undo?.entries ?? [])])
      entry.cues = [
        {
          kind: "topic",
          text: "Synthetic cue",
          evidence: [
            {
              source: "imessage",
              messageId: "synthetic",
              sentAt: now.toISOString(),
              excerpt: "Synthetic snippet",
            },
          ],
        },
      ];
    await prisma.callSheetDay.update({
      where: { id: day.id },
      data: { entries: JSON.parse(JSON.stringify(data)) },
    });
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: false },
      now,
    );
    expect(
      JSON.stringify(
        (await prisma.callSheetDay.findUniqueOrThrow({ where: { id: day.id } }))
          .entries,
      ),
    ).not.toContain("Synthetic snippet");
  });
  it("recognizes existing CRM check-in interactions as recent manual contact", async () => {
    const person = await prisma.person.findFirstOrThrow({ where: { userId } });
    await prisma.interaction.create({
      data: {
        userId,
        personIds: [person.id],
        occurredAt: new Date(now.getTime() - 1000),
        kind: "other",
        source: "checkin",
        title: "Synthetic existing check-in",
      },
    });
    expect(
      (await getCallSheet(userId, now)).entries.some(
        (entry) => entry.personId === person.id,
      ),
    ).toBe(false);
  });
  it("expires excerpts in live state, historical sheets, and their undo snapshots", async () => {
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: true },
      now,
    );
    const input = await payload();
    await captureCallSheet(
      userId,
      { ...input, messages: [], extract: false },
      now,
    );
    const sheet = await getCallSheet(userId, now);
    const replaced = await mutateCallSheet(
      userId,
      {
        dayId: sheet.day.id,
        version: sheet.day.version,
        entryId: sheet.entries[0].id,
        action: "replace",
      },
      now,
    );
    const day = await prisma.callSheetDay.findUniqueOrThrow({
      where: { id: replaced.day.id },
    });
    const data = readDay(day.entries);
    const expired = {
      kind: "topic" as const,
      text: "Expired topic",
      evidence: [
        {
          source: "imessage" as const,
          messageId: "expired",
          sentAt: "2026-01-01T00:00:00.000Z",
          excerpt: "expired snippet",
        },
      ],
    };
    for (const entry of [...data.entries, ...(data.undo?.entries ?? [])])
      entry.cues = [expired];
    await prisma.callSheetDay.update({
      where: { id: day.id },
      data: {
        localDate: "2026-06-01",
        entries: JSON.parse(JSON.stringify(data)),
      },
    });
    const contact = await prisma.callSheetContact.findUniqueOrThrow({
      where: { userId_personId: { userId, personId: input.personId } },
    });
    const sourceData = readSourceData(contact.sourceData);
    sourceData.imessage!.cues = [expired];
    await prisma.callSheetContact.update({
      where: { id: contact.id },
      data: { sourceData: JSON.parse(JSON.stringify(sourceData)) },
    });
    await getCallSheet(userId, now);
    expect(
      JSON.stringify(
        (await prisma.callSheetDay.findUniqueOrThrow({ where: { id: day.id } }))
          .entries,
      ),
    ).not.toContain("expired snippet");
    expect(
      JSON.stringify(
        (
          await prisma.callSheetContact.findUniqueOrThrow({
            where: { id: contact.id },
          })
        ).sourceData,
      ),
    ).not.toContain("expired snippet");
  });
  it("new activity invalidates old cues until the next extraction", async () => {
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: true },
      now,
    );
    const input = await payload();
    const cue = {
      kind: "follow_up" as const,
      text: "Ask about the trip",
      evidence: [
        {
          source: "imessage" as const,
          messageId: input.messages[0].guid,
          sentAt: input.messages[0].sentAt,
          excerpt: "trip",
        },
      ],
    };
    vi.mocked(extractCallSheetCues).mockResolvedValueOnce([cue]);
    await captureCallSheet(userId, input, now);
    await captureCallSheet(
      userId,
      {
        ...input,
        lastContactAt: "2026-09-27T12:00:00.000Z",
        messageCount: 2,
        messages: [],
        extract: false,
      },
      now,
    );
    const state = readSourceData(
      (
        await prisma.callSheetContact.findUniqueOrThrow({
          where: { userId_personId: { userId, personId: input.personId } },
        })
      ).sourceData,
    ).imessage;
    expect(state?.cues).toEqual([]);
    expect(state?.extractionPending).toBe(true);
  });
  it("rejects async extraction after identity edits without restoring old evidence", async () => {
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: true },
      now,
    );
    const input = await payload();
    let resolve!: (value: []) => void;
    let started!: () => void;
    const called = new Promise<void>((r) => {
      started = r;
    });
    vi.mocked(extractCallSheetCues).mockImplementationOnce(() => {
      started();
      return new Promise((r) => {
        resolve = r;
      });
    });
    const pending = captureCallSheet(userId, input, now);
    await called;
    await prisma.person.update({
      where: { id: input.personId },
      data: { phone: "+15559990000" },
    });
    resolve([]);
    await expect(pending).rejects.toThrow("identity changed");
    await getCallSheet(userId, now);
    expect(
      readSourceData(
        (
          await prisma.callSheetContact.findUniqueOrThrow({
            where: { userId_personId: { userId, personId: input.personId } },
          })
        ).sourceData,
      ),
    ).toEqual({});
  });
  it("counts stable existing categories when replacing or filling an archived slot", async () => {
    const alternatives = await Promise.all(
      ["One", "Two"].map((lastName) =>
        prisma.person.create({
          data: {
            userId,
            firstName: "Additional",
            lastName,
            circles: ["family"],
          },
        }),
      ),
    );
    await prisma.interaction.create({
      data: {
        userId,
        personIds: alternatives.map((person) => person.id),
        occurredAt: new Date("2026-01-01T00:00:00Z"),
        kind: "meeting",
        title: "Synthetic alternative encounter",
        source: "manual",
      },
    });
    await prisma.person.updateMany({
      where: { userId, circles: { has: "friends" } },
      data: { starred: true },
    });
    const people = await prisma.person.findMany({ where: { userId } });
    const friends = new Set(
      people.filter((p) => p.circles.includes("friends")).map((p) => p.id),
    );
    const sheet = await getCallSheet(userId, now);
    expect(
      sheet.entries.filter((entry) => friends.has(entry.personId)),
    ).toHaveLength(2);
    const target = sheet.entries.find((entry) => !friends.has(entry.personId))!;
    const replaced = await mutateCallSheet(
      userId,
      {
        dayId: sheet.day.id,
        version: sheet.day.version,
        entryId: target.id,
        action: "replace",
      },
      now,
    );
    expect(
      replaced.entries.filter((entry) => friends.has(entry.personId)),
    ).toHaveLength(2);
    const archived = replaced.entries.find(
      (entry) => !friends.has(entry.personId),
    )!;
    await prisma.person.update({
      where: { id: archived.personId },
      data: { archived: true },
    });
    const fresh = await getCallSheet(userId, now);
    expect(fresh.entries).toHaveLength(5);
    expect(
      fresh.entries.filter((entry) => friends.has(entry.personId)),
    ).toHaveLength(2);
  });
  it("shares one three-snippet budget across source ingestions and cleans legacy six-cue states", async () => {
    await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: true },
      now,
    );
    await updateCallSheetSettings(
      userId,
      { source: "whatsapp", enabled: true },
      now,
    );
    const config = await getCaptureConfig(userId);
    const input = await payload();
    const makeCues = (source: "imessage" | "whatsapp", days: number[]) =>
      days.map((day) => ({
        kind: "topic" as const,
        text: `${source} ${day}`,
        evidence: [
          {
            source,
            messageId: `${source}-${day}`,
            sentAt: `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`,
            excerpt: `Synthetic ${day}`,
          },
        ],
      }));
    const imessage = makeCues("imessage", [1, 25, 20]);
    const whatsapp = makeCues("whatsapp", [26, 24, 2]);
    for (const [source, cues] of [
      ["imessage", imessage],
      ["whatsapp", whatsapp],
    ] as const) {
      vi.mocked(extractCallSheetCues).mockResolvedValueOnce(cues);
      const messages = cues.map((cue) => ({
        guid: cue.evidence[0].messageId,
        sentAt: cue.evidence[0].sentAt,
        fromMe: false,
        text: cue.evidence[0].excerpt,
      }));
      await captureCallSheet(
        userId,
        {
          ...input,
          source,
          sourceEpoch: config.sourceEpochs![source],
          messages,
          messageCount: 3,
          lastContactAt: [...messages].sort((a, b) =>
            b.sentAt.localeCompare(a.sentAt),
          )[0].sentAt,
        },
        now,
      );
    }
    const contact = await prisma.callSheetContact.findUniqueOrThrow({
      where: { userId_personId: { userId, personId: input.personId } },
    });
    const data = readSourceData(contact.sourceData);
    expect(data.imessage!.cues.map((cue) => cue.text)).toEqual(["imessage 25"]);
    expect(data.whatsapp!.cues.map((cue) => cue.text)).toEqual([
      "whatsapp 26",
      "whatsapp 24",
    ]);
    data.imessage!.cues = imessage;
    data.whatsapp!.cues = whatsapp;
    await prisma.callSheetContact.update({
      where: { id: contact.id },
      data: { sourceData: JSON.parse(JSON.stringify(data)) },
    });
    const sheet = await getCallSheet(userId, now);
    const day = await prisma.callSheetDay.findUniqueOrThrow({
      where: { id: sheet.day.id },
    });
    const snapshot = readDay(day.entries);
    snapshot.entries[0].cues = [...imessage, ...whatsapp];
    await prisma.callSheetDay.create({
      data: {
        userId,
        localDate: "2026-09-27",
        timezone: "UTC",
        entries: JSON.parse(JSON.stringify(snapshot)),
      },
    });
    await getCallSheet(userId, now);
    const cleaned = readSourceData(
      (
        await prisma.callSheetContact.findUniqueOrThrow({
          where: { id: contact.id },
        })
      ).sourceData,
    );
    expect(
      [...cleaned.imessage!.cues, ...cleaned.whatsapp!.cues].flatMap(
        (cue) => cue.evidence,
      ),
    ).toHaveLength(3);
    const oldDay = await prisma.callSheetDay.findUniqueOrThrow({
      where: { userId_localDate: { userId, localDate: "2026-09-27" } },
    });
    expect(
      readDay(oldDay.entries).entries[0].cues.flatMap((cue) => cue.evidence),
    ).toHaveLength(3);
  });
  it("keeps known past encounters when a future-dated encounter exists", async () => {
    const people = await prisma.person.findMany({ where: { userId } });
    await prisma.interaction.create({
      data: {
        userId,
        personIds: people.map((person) => person.id),
        occurredAt: new Date("2026-10-01T00:00:00Z"),
        kind: "meeting",
        title: "Synthetic future encounter",
        source: "manual",
      },
    });
    const sheet = await getCallSheet(userId, now);
    expect(sheet.entries).toHaveLength(5);
    expect(
      sheet.entries.every(
        (entry) => entry.lastContactAt === "2026-01-01T00:00:00.000Z",
      ),
    ).toBe(true);
  });
  it("deletes owned person snapshots immediately across history and Undo without touching another owner", async () => {
    const sheet = await getCallSheet(userId, now);
    const removed = sheet.entries[0];
    const changed = await mutateCallSheet(
      userId,
      {
        dayId: sheet.day.id,
        version: sheet.day.version,
        entryId: removed.id,
        action: "replace",
      },
      now,
    );
    const current = await prisma.callSheetDay.findUniqueOrThrow({
      where: { id: changed.day.id },
    });
    const snapshot = readDay(current.entries);
    const original = snapshot.undo!.entries.find(
      (entry) => entry.personId === removed.personId,
    )!;
    original.cues = [
      {
        kind: "topic",
        text: "Private deleted topic",
        evidence: [
          {
            source: "imessage",
            messageId: "deleted-message",
            sentAt: now.toISOString(),
            excerpt: "Private deleted snippet",
          },
        ],
      },
    ];
    snapshot.entries = [original, ...snapshot.entries.slice(1)];
    snapshot.skipped.push(removed.personId);
    snapshot.undo!.skipped.push(removed.personId);
    await prisma.callSheetDay.update({
      where: { id: current.id },
      data: { entries: JSON.parse(JSON.stringify(snapshot)) },
    });
    await prisma.callSheetDay.create({
      data: {
        userId,
        localDate: "2026-09-27",
        timezone: "UTC",
        entries: JSON.parse(JSON.stringify(snapshot)),
      },
    });
    await getCallSheet(otherId, now);
    const otherBefore = await prisma.callSheetDay.findMany({
      where: { userId: otherId },
    });
    const ownBefore = await prisma.callSheetDay.findMany({ where: { userId } });
    expect(
      await deletePersonWithCallSheetCleanup(otherId, removed.personId),
    ).toBe(0);
    expect(await prisma.callSheetDay.findMany({ where: { userId } })).toEqual(
      ownBefore,
    );
    expect(
      await deletePersonWithCallSheetCleanup(userId, removed.personId),
    ).toBe(1);
    expect(
      await prisma.person.findUnique({ where: { id: removed.personId } }),
    ).toBeNull();
    expect(
      await prisma.callSheetContact.count({
        where: { userId, personId: removed.personId },
      }),
    ).toBe(0);
    for (const day of await prisma.callSheetDay.findMany({
      where: { userId },
    })) {
      const saved = JSON.stringify(day.entries);
      expect(saved).not.toContain(removed.personId);
      expect(saved).not.toContain(removed.name);
      expect(saved).not.toContain(removed.phone!);
      expect(saved).not.toContain("Private deleted snippet");
      expect(readDay(day.entries).undo).toBeUndefined();
    }
    expect(
      await prisma.callSheetDay.findMany({ where: { userId: otherId } }),
    ).toEqual(otherBefore);
  });
  it("invalidates Undo when its replacement person is deleted", async () => {
    const sheet = await getCallSheet(userId, now);
    const changed = await mutateCallSheet(
      userId,
      {
        dayId: sheet.day.id,
        version: sheet.day.version,
        entryId: sheet.entries[0].id,
        action: "replace",
      },
      now,
    );
    const replacement = changed.entries[0];
    expect(changed.undoToken).toBeDefined();
    await deletePersonWithCallSheetCleanup(userId, replacement.personId);
    const stored = readDay(
      (
        await prisma.callSheetDay.findUniqueOrThrow({
          where: { id: sheet.day.id },
        })
      ).entries,
    );
    expect(stored.undo).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain(replacement.personId);
  });
  it("sheet maintenance removes archived, changed and directly deleted identities from historical and Undo snapshots", async () => {
    const sheet = await getCallSheet(userId, now);
    const changed = await mutateCallSheet(
      userId,
      {
        dayId: sheet.day.id,
        version: sheet.day.version,
        entryId: sheet.entries[0].id,
        action: "replace",
      },
      now,
    );
    const current = await prisma.callSheetDay.findUniqueOrThrow({
      where: { id: changed.day.id },
    });
    const snapshot = readDay(current.entries);
    const archivedId = sheet.entries[0].personId;
    const identityChangedId = sheet.entries[1].personId;
    const deletedId = sheet.entries[2].personId;
    const revoked = new Set([archivedId, identityChangedId, deletedId]);
    for (const entry of [...snapshot.entries, ...snapshot.undo!.entries])
      if (revoked.has(entry.personId))
        entry.cues = [
          {
            kind: "topic",
            text: "Revoked topic",
            evidence: [
              {
                source: "imessage",
                messageId: "revoked-message",
                sentAt: now.toISOString(),
                excerpt: "Revoked identity snippet",
              },
            ],
          },
        ];
    snapshot.skipped.push(...revoked);
    snapshot.undo!.skipped.push(...revoked);
    await prisma.callSheetDay.update({
      where: { id: current.id },
      data: { entries: JSON.parse(JSON.stringify(snapshot)) },
    });
    await prisma.callSheetDay.create({
      data: {
        userId,
        localDate: "2026-09-27",
        timezone: "UTC",
        entries: JSON.parse(JSON.stringify(snapshot)),
      },
    });
    await prisma.person.update({
      where: { id: archivedId },
      data: { archived: true },
    });
    await prisma.person.update({
      where: { id: identityChangedId },
      data: { phone: "+15558880000" },
    });
    await prisma.person.delete({ where: { id: deletedId } });
    const fresh = await getCallSheet(userId, now);
    expect(fresh.undoToken).toBeUndefined();
    for (const day of await prisma.callSheetDay.findMany({
      where: { userId },
    })) {
      const data = readDay(day.entries);
      expect(data.entries.some((entry) => revoked.has(entry.personId))).toBe(
        false,
      );
      expect(data.undo).toBeUndefined();
      expect(data.skipped).not.toContain(archivedId);
      expect(data.skipped).not.toContain(deletedId);
      expect(JSON.stringify(data)).not.toContain("Revoked identity snippet");
    }
  });
  it("replaces newly discovered pre-sheet contact but marks genuinely later contact as contacted", async () => {
    const initial = await updateCallSheetSettings(
      userId,
      { source: "imessage", enabled: true },
      now,
    );
    const config = await getCaptureConfig(userId);
    const template = await payload();
    const discovered = initial.entries[2];
    const identity = config.people.find(
      (person) => person.id === discovered.personId,
    )!;
    await captureCallSheet(
      userId,
      {
        ...template,
        personId: discovered.personId,
        identityKey: identity.identityKey,
        handles: [identity.phone!],
        lastContactAt: "2026-09-26T12:00:00.000Z",
        messages: [],
        extract: false,
      },
      now,
    );
    const refreshed = await getCallSheet(userId, now);
    expect(refreshed.entries).toHaveLength(5);
    expect(refreshed.entries[2].personId).not.toBe(discovered.personId);
    for (const index of [0, 1, 3, 4])
      expect(refreshed.entries[index].id).toBe(initial.entries[index].id);
    expect(refreshed.entries.every((entry) => entry.status === "pending")).toBe(
      true,
    );
    const later = new Date(now.getTime() + 60_000);
    const contacted = refreshed.entries[1];
    const laterIdentity = config.people.find(
      (person) => person.id === contacted.personId,
    )!;
    await captureCallSheet(
      userId,
      {
        ...template,
        personId: contacted.personId,
        identityKey: laterIdentity.identityKey,
        handles: [laterIdentity.phone!],
        capturedAt: later.toISOString(),
        lastContactAt: later.toISOString(),
        messages: [],
        extract: false,
      },
      later,
    );
    const laterSheet = await getCallSheet(userId, later);
    expect(laterSheet.entries[1]).toMatchObject({
      id: contacted.id,
      status: "contacted",
      reason: "You have been in touch since this was suggested.",
    });
    expect(laterSheet.entries.map((entry) => entry.id)).toEqual(
      refreshed.entries.map((entry) => entry.id),
    );
  });
  describe("quick review of people with no contact on record", () => {
    async function silent(
      owner: string,
      firstName: string,
      extra: Record<string, unknown> = {},
    ) {
      return prisma.person.create({
        data: {
          userId: owner,
          firstName,
          lastName: "Quiet",
          phone: `+1555777${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`,
          ...extra,
        },
      });
    }
    it("lists only verifiably silent, unreviewed people, owner-scoped, A to Z", async () => {
      const zoe = await silent(userId, "Zoe", { company: "Acme", role: "CTO" });
      const abe = await silent(userId, "Abe", {
        phone: null,
        strength: "1 - met",
        howWeMet: "Conference",
        circles: ["work"],
        context: { summary: "Long summary. ".repeat(40) },
      });
      await silent(userId, "Star", { starred: true });
      await silent(userId, "Gone", { archived: true });
      const kept = await silent(userId, "Kept");
      const hidden = await silent(userId, "Hidden");
      const snoozed = await silent(userId, "Snoozed");
      for (const [person, values] of [
        [kept, { cadenceDays: 90 }],
        [hidden, { excludedAt: now }],
        [
          snoozed,
          { snoozedUntil: new Date("2026-10-10"), lastSuggestedAt: now },
        ],
      ] as const)
        await prisma.callSheetContact.create({
          data: {
            userId,
            personId: person.id,
            identityKey: "x".repeat(64),
            ...values,
          },
        });
      const foreign = await silent(otherId, "Foreign");
      const review = await getCallSheetReview(userId, now);
      expect(review.people.map((person) => person.personId)).toEqual([
        abe.id,
        snoozed.id,
        zoe.id,
      ]);
      expect(review.total).toBe(3);
      expect(review.people[0]).toMatchObject({
        name: "Abe Quiet",
        strength: "1 - met",
        howWeMet: "Conference",
        circles: ["work"],
        reachable: false,
      });
      expect(review.people[0].summary!.length).toBeLessThanOrEqual(240);
      expect(review.people[2]).toMatchObject({
        company: "Acme",
        role: "CTO",
        summary: null,
        reachable: true,
      });
      expect((await getCallSheet(userId, now)).reviewCount).toBe(3);
      expect(
        (await getCallSheetReview(otherId, now)).people.map((p) => p.personId),
      ).toEqual([foreign.id]);
      // An enabled source with no fresh scan of them means silence is unproven.
      await updateCallSheetSettings(
        userId,
        { source: "imessage", enabled: true },
        now,
      );
      expect((await getCallSheetReview(userId, now)).total).toBe(0);
      expect((await getCallSheet(userId, now)).reviewCount).toBe(0);
    });
    it("keep, hide and reset write the preference; foreign, archived and bad input are refused", async () => {
      const person = await silent(userId, "Decide");
      const contact = () =>
        prisma.callSheetContact.findUniqueOrThrow({
          where: { userId_personId: { userId, personId: person.id } },
        });
      expect(
        await decideCallSheetReview(
          userId,
          { personId: person.id, decision: "keep", cadenceDays: 30 },
          now,
        ),
      ).toEqual({ ok: true });
      expect(await contact()).toMatchObject({
        cadenceDays: 30,
        excludedAt: null,
      });
      expect((await getCallSheet(userId, now)).reviewCount).toBe(0);
      await decideCallSheetReview(
        userId,
        { personId: person.id, decision: "reset" },
        now,
      );
      expect(await contact()).toMatchObject({
        cadenceDays: null,
        excludedAt: null,
      });
      expect((await getCallSheet(userId, now)).reviewCount).toBe(1);
      await decideCallSheetReview(
        userId,
        { personId: person.id, decision: "hide" },
        now,
      );
      expect(await contact()).toMatchObject({ excludedAt: now });
      expect((await getCallSheetReview(userId, now)).total).toBe(0);
      await expect(
        decideCallSheetReview(
          otherId,
          { personId: person.id, decision: "hide" },
          now,
        ),
      ).rejects.toMatchObject({ status: 404 });
      const archived = await silent(userId, "Archived", { archived: true });
      await expect(
        decideCallSheetReview(
          userId,
          { personId: archived.id, decision: "keep", cadenceDays: 90 },
          now,
        ),
      ).rejects.toMatchObject({ status: 404 });
      for (const bad of [
        { personId: person.id, decision: "keep" },
        { personId: person.id, decision: "keep", cadenceDays: 6 },
        { personId: person.id, decision: "keep", cadenceDays: 731 },
        { personId: person.id, decision: "keep", cadenceDays: 30.5 },
        { personId: person.id, decision: "keep", cadenceDays: "30" },
        { personId: person.id, decision: "hide", cadenceDays: 30 },
        { personId: person.id, decision: "reset", cadenceDays: null },
        { personId: person.id, decision: "maybe" },
        { personId: person.id, decision: "hide", extra: true },
        { decision: "hide" },
        null,
        [],
      ])
        expect(() => decideCallSheetReview(userId, bad, now)).toThrow();
      expect(
        await prisma.callSheetContact.count({
          where: { userId: otherId },
        }),
      ).toBe(0);
    });
    it("puts silent people on the sheet with an honest reason, and a review hide removes them on the next read", async () => {
      await prisma.person.updateMany({
        where: { userId },
        data: { archived: true },
      });
      const person = await silent(userId, "Listed");
      const sheet = await getCallSheet(userId, now);
      expect(sheet.entries).toHaveLength(1);
      expect(sheet.entries[0]).toMatchObject({
        personId: person.id,
        reason: "No contact on record.",
        lastContactAt: null,
        status: "pending",
      });
      expect((await getCallSheet(userId, now)).entries[0].reason).toBe(
        "No contact on record.",
      );
      await decideCallSheetReview(
        userId,
        { personId: person.id, decision: "hide" },
        now,
      );
      const next = await getCallSheet(userId, now);
      expect(next.entries).toEqual([]);
      expect(next.reviewCount).toBe(0);
    });
    it("flips a no-contact suggestion to contacted when contact appears", async () => {
      await prisma.person.updateMany({
        where: { userId },
        data: { archived: true },
      });
      const person = await silent(userId, "Listed");
      const sheet = await getCallSheet(userId, now);
      const later = new Date(now.getTime() + 60_000);
      await prisma.interaction.create({
        data: {
          userId,
          personIds: [person.id],
          occurredAt: later,
          kind: "call",
          title: "Synthetic later call",
          source: "manual",
        },
      });
      expect((await getCallSheet(userId, later)).entries[0]).toMatchObject({
        id: sheet.entries[0].id,
        status: "contacted",
        reason: "You have been in touch since this was suggested.",
      });
    });
    it("sends the Mac worker a cadence that reflects message volume", async () => {
      await updateCallSheetSettings(
        userId,
        { source: "imessage", enabled: true },
        now,
      );
      const input = await payload();
      const cadenceFor = async () =>
        (await getCaptureConfig(userId)).people.find(
          (person) => person.id === input.personId,
        )!.cadenceDays;
      expect(await cadenceFor()).toBe(90);
      await captureCallSheet(
        userId,
        { ...input, messageCount: 600, messages: [], extract: false },
        now,
      );
      expect(await cadenceFor()).toBe(30);
      // Evidence stored under an old identity does not count.
      await prisma.person.update({
        where: { id: input.personId },
        data: { phone: "+15559990001" },
      });
      expect(await cadenceFor()).toBe(90);
    });
  });
  describe("user-set reminders", () => {
    const offSheet = async (id = userId) => {
      const sheet = await getCallSheet(id, now);
      const person = await prisma.person.findFirstOrThrow({
        where: {
          userId: id,
          id: { notIn: sheet.entries.map((entry) => entry.personId) },
        },
        orderBy: { lastName: "asc" },
      });
      return { sheet, person };
    };
    const contactOf = (personId: string) =>
      prisma.callSheetContact.findUnique({
        where: { userId_personId: { userId, personId } },
      });
    it("adds a reminder due today to a full day as a sixth row on top, once, and clears it", async () => {
      const { sheet, person } = await offSheet();
      expect(sheet.entries).toHaveLength(5);
      // Snooze and a recent suggestion do not hold back an explicit request.
      await prisma.callSheetContact.upsert({
        where: { userId_personId: { userId, personId: person.id } },
        create: {
          userId,
          personId: person.id,
          identityKey: "stale",
          snoozedUntil: new Date("2026-12-01T00:00:00Z"),
          lastSuggestedAt: now,
        },
        update: {
          snoozedUntil: new Date("2026-12-01T00:00:00Z"),
          lastSuggestedAt: now,
        },
      });
      const after = await setCallSheetReminder(
        userId,
        { personId: person.id, dueOn: "2026-09-28", note: "the lease" },
        now,
      );
      expect(after.entries).toHaveLength(6);
      expect(after.entries[0]).toMatchObject({
        personId: person.id,
        reason: "You asked to be reminded today.",
        reminder: { note: "the lease" },
        status: "pending",
      });
      expect(after.entries.slice(1).map((entry) => entry.id)).toEqual(
        sheet.entries.map((entry) => entry.id),
      );
      expect(await contactOf(person.id)).toMatchObject({
        dueOn: null,
        dueNote: null,
        snoozedUntil: null,
      });
      const again = await getCallSheet(userId, now);
      expect(again.entries).toHaveLength(6);
      expect(again.day.version).toBe(after.day.version);
      expect(
        again.entries.filter((entry) => entry.personId === person.id),
      ).toHaveLength(1);
    });
    it("fires on the next opened day when the due day was missed, and lists it as upcoming before", async () => {
      const { person } = await offSheet();
      const set = await setCallSheetReminder(
        userId,
        { personId: person.id, dueOn: "2026-09-30", note: null },
        now,
      );
      expect(set.upcoming).toEqual([
        {
          personId: person.id,
          name: `${person.firstName} ${person.lastName}`,
          dueOn: "2026-09-30",
          note: null,
        },
      ]);
      expect(set.entries.some((entry) => entry.personId === person.id)).toBe(
        false,
      );
      const late = new Date("2026-10-03T16:00:00Z");
      const sheet = await getCallSheet(userId, late);
      expect(sheet.entries[0]).toMatchObject({
        personId: person.id,
        reason: "You asked to be reminded today.",
      });
      expect(sheet.upcoming).toEqual([]);
      expect((await contactOf(person.id))?.dueOn).toBeNull();
    });
    it("cancels a reminder, and rejects past, far-future and foreign requests", async () => {
      const { person } = await offSheet();
      await setCallSheetReminder(
        userId,
        { personId: person.id, dueOn: "2026-10-06" },
        now,
      );
      const cancelled = await setCallSheetReminder(
        userId,
        { personId: person.id, dueOn: null },
        now,
      );
      expect(cancelled.upcoming).toEqual([]);
      expect((await contactOf(person.id))?.dueOn).toBeNull();
      await expect(
        setCallSheetReminder(
          userId,
          { personId: person.id, dueOn: "2026-09-27" },
          now,
        ),
      ).rejects.toThrow("already passed");
      await expect(
        setCallSheetReminder(
          userId,
          { personId: person.id, dueOn: "2028-09-28" },
          now,
        ),
      ).rejects.toThrow("two years");
      const foreign = await prisma.person.findFirstOrThrow({
        where: { userId: otherId },
      });
      await expect(
        setCallSheetReminder(
          userId,
          { personId: foreign.id, dueOn: "2026-10-06" },
          now,
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("hiding a person clears their pending reminder and Undo restores it", async () => {
      const sheet = await getCallSheet(userId, now);
      const entry = sheet.entries[2];
      const set = await setCallSheetReminder(
        userId,
        { personId: entry.personId, dueOn: "2026-10-06", note: "trip" },
        now,
      );
      expect(set.upcoming.map((item) => item.personId)).toEqual([
        entry.personId,
      ]);
      const hidden = await mutateCallSheet(
        userId,
        {
          dayId: set.day.id,
          version: set.day.version,
          entryId: entry.id,
          action: "hide",
        },
        now,
      );
      expect(hidden.upcoming).toEqual([]);
      expect(await contactOf(entry.personId)).toMatchObject({
        dueOn: null,
        dueNote: null,
      });
      const undone = await mutateCallSheet(
        userId,
        {
          dayId: hidden.day.id,
          version: hidden.day.version,
          action: "undo",
          undoToken: hidden.undoToken,
        },
        now,
      );
      expect(undone.upcoming).toEqual([
        expect.objectContaining({ personId: entry.personId, dueOn: "2026-10-06", note: "trip" }),
      ]);
    });
    it("a fired reminder row survives undoing an unrelated earlier action", async () => {
      const sheet = await getCallSheet(userId, now);
      const replaced = await mutateCallSheet(
        userId,
        {
          dayId: sheet.day.id,
          version: sheet.day.version,
          entryId: sheet.entries[1].id,
          action: "replace",
        },
        now,
      );
      // Someone neither on the sheet now nor the person just replaced.
      const person = await prisma.person.findFirstOrThrow({
        where: {
          userId,
          id: {
            notIn: [
              ...replaced.entries.map((entry) => entry.personId),
              sheet.entries[1].personId,
            ],
          },
        },
      });
      const withReminder = await setCallSheetReminder(
        userId,
        { personId: person.id, dueOn: "2026-09-28" },
        now,
      );
      expect(withReminder.entries[0].personId).toBe(person.id);
      expect(withReminder.undoToken).toBe(replaced.undoToken);
      const undone = await mutateCallSheet(
        userId,
        {
          dayId: withReminder.day.id,
          version: withReminder.day.version,
          action: "undo",
          undoToken: withReminder.undoToken,
        },
        now,
      );
      expect(undone.entries[0]).toMatchObject({
        personId: person.id,
        reminder: { note: null },
      });
      expect(undone.entries[2].id).toBe(sheet.entries[1].id);
    });
  });
});
