import { beforeEach, describe, expect, it, vi } from "vitest";
// In-memory stand-in for the handful of Prisma calls the sheet makes, so the
// reminder placement rules run without any database (the real-PostgreSQL spec
// lives in integration.test.ts behind RUN_CALL_SHEET_INTEGRATION).
const db = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string };
  const state = {
    people: [] as Row[],
    contacts: [] as Row[],
    days: [] as Row[],
    seq: 0,
  };
  const match = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) =>
      value && typeof value === "object" && "in" in (value as object)
        ? (value as { in: unknown[] }).in.includes(row[key])
        : row[key] === value,
    );
  const tx = {
    $executeRaw: async () => 0,
    callSheetSettings: {
      upsert: async () => ({ userId: "u", timezone: "UTC", sources: {} }),
    },
    person: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        state.people.filter((p) => match(p, where)).map((p) => ({ ...p })),
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        state.people.find((p) => match(p, where)) ?? null,
    },
    interaction: { findMany: async () => [] },
    callSheetContact: {
      findMany: async () => state.contacts.map((c) => ({ ...c })),
      update: async ({ where, data }: { where: { id: string }; data: object }) =>
        Object.assign(state.contacts.find((c) => c.id === where.id)!, data),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId_personId: { userId: string; personId: string } };
        create: object;
        update: object;
      }) => {
        const found = state.contacts.find(
          (c) => c.personId === where.userId_personId.personId,
        );
        if (found) return Object.assign(found, update);
        const row = {
          id: `c${++state.seq}`,
          cadenceDays: null,
          snoozedUntil: null,
          excludedAt: null,
          lastSuggestedAt: null,
          lastCompletedAt: null,
          dueOn: null,
          dueNote: null,
          sourceData: {},
          ...create,
        };
        state.contacts.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: object;
      }) => {
        const rows = state.contacts.filter((c) => match(c, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    callSheetDay: {
      findMany: async () => state.days.map((d) => ({ ...d })),
      findUnique: async ({
        where,
      }: {
        where: { userId_localDate: { localDate: string } };
      }) =>
        state.days.find(
          (d) => d.localDate === where.userId_localDate.localDate,
        ) ?? null,
      create: async ({ data }: { data: object }) => {
        const row = { id: `d${++state.seq}`, version: 0, ...data } as Row;
        state.days.push(row);
        return { ...row };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { entries: unknown };
      }) => {
        const row = state.days.find((d) => d.id === where.id)!;
        row.entries = data.entries;
        row.version = (row.version as number) + 1;
        return { ...row };
      },
    },
  };
  return { state, tx };
});
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (work: (tx: unknown) => unknown) => work(db.tx) },
}));
import { getCallSheet, parseReminder, setCallSheetReminder } from "./service";

const now = new Date("2026-09-28T16:00:00Z"); // Monday; UTC sheet date 2026-09-28
function addPerson(id: string, extra: Record<string, unknown> = {}) {
  db.state.people.push({
    id,
    userId: "u",
    firstName: "Test",
    lastName: id,
    phone: null,
    email: null,
    imageUrl: null,
    archived: false,
    starred: false,
    strength: "casual",
    circles: [],
    tags: [],
    birthday: null,
    lastInteractionAt: null,
    ...extra,
  });
}
const contact = (personId: string) =>
  db.state.contacts.find((c) => c.personId === personId);
beforeEach(() => {
  db.state.people = [];
  db.state.contacts = [];
  db.state.days = [];
  db.state.seq = 0;
  db.tx.interaction.findMany = async () => [];
});

describe("parseReminder", () => {
  it("accepts a date with a trimmed note, or null to cancel", () => {
    expect(
      parseReminder({ personId: "p", dueOn: "2026-10-06", note: "  the lease " }),
    ).toEqual({ personId: "p", dueOn: "2026-10-06", note: "the lease" });
    expect(parseReminder({ personId: "p", dueOn: null })).toEqual({
      personId: "p",
      dueOn: null,
      note: null,
    });
  });
  it.each([
    [{ personId: "p" }, "Choose a valid date"],
    [{ personId: "p", dueOn: "2026-02-30" }, "Choose a valid date"],
    [{ personId: "p", dueOn: "Tuesday" }, "Choose a valid date"],
    [{ personId: "", dueOn: null }, "Invalid identifier"],
    [{ personId: "p", dueOn: null, note: 4 }, "Invalid note"],
    [{ personId: "p", dueOn: null, note: "x".repeat(201) }, "200 characters"],
    [{ personId: "p", dueOn: null, extra: 1 }, "Unknown field"],
    [[], "Expected an object"],
  ])("rejects %j", (input, message) => {
    expect(() => parseReminder(input)).toThrow(message);
  });
});

describe("setCallSheetReminder", () => {
  it("rejects past dates, dates beyond two years and other people's records", async () => {
    addPerson("grace");
    await expect(
      setCallSheetReminder("u", { personId: "grace", dueOn: "2026-09-27" }, now),
    ).rejects.toThrow("already passed");
    await expect(
      setCallSheetReminder("u", { personId: "grace", dueOn: "2028-09-28" }, now),
    ).rejects.toThrow("two years");
    await expect(
      setCallSheetReminder("u", { personId: "nobody", dueOn: "2026-10-06" }, now),
    ).rejects.toMatchObject({ status: 404 });
    addPerson("gone", { archived: true });
    await expect(
      setCallSheetReminder("u", { personId: "gone", dueOn: "2026-10-06" }, now),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.state.contacts).toHaveLength(0);
  });

  it("lists a future reminder as upcoming, clears hide/snooze, and cancels", async () => {
    addPerson("grace", { firstName: "Grace", lastName: "Kotick", manualAt: null });
    db.tx.callSheetContact.upsert({
      where: { userId_personId: { userId: "u", personId: "grace" } },
      create: {
        personId: "grace",
        userId: "u",
        identityKey: "x",
        excludedAt: now,
        snoozedUntil: new Date("2026-12-01"),
      },
      update: {},
    });
    const set = await setCallSheetReminder(
      "u",
      { personId: "grace", dueOn: "2026-10-06", note: "the lease" },
      now,
    );
    expect(set.upcoming).toEqual([
      { personId: "grace", name: "Grace Kotick", dueOn: "2026-10-06", note: "the lease" },
    ]);
    expect(set.entries.some((e) => e.personId === "grace")).toBe(false);
    expect(contact("grace")).toMatchObject({
      dueOn: "2026-10-06",
      dueNote: "the lease",
      excludedAt: null,
      snoozedUntil: null,
    });
    const cancelled = await setCallSheetReminder(
      "u",
      { personId: "grace", dueOn: null },
      now,
    );
    expect(cancelled.upcoming).toEqual([]);
    expect(contact("grace")).toMatchObject({ dueOn: null, dueNote: null });
  });

  it("adds a reminder due today to a full day as a sixth row on top, once", async () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) addPerson(id);
    // a–f have an old saved check-in, so the first sheet fills to five; Grace
    // has no history at all, so she would never be suggested on her own.
    db.tx.interaction.findMany = async () =>
      [
        {
          personIds: ["a", "b", "c", "d", "e", "f"],
          occurredAt: new Date("2026-01-01T00:00:00Z"),
        },
      ] as never;
    addPerson("grace", { firstName: "Grace", lastName: "Kotick" });
    const first = await getCallSheet("u", now);
    expect(first.entries).toHaveLength(5);
    expect(first.entries.some((e) => e.personId === "grace")).toBe(false);
    const after = await setCallSheetReminder(
      "u",
      { personId: "grace", dueOn: "2026-09-28", note: "about the lease" },
      now,
    );
    expect(after.entries).toHaveLength(6);
    expect(after.entries[0]).toMatchObject({
      personId: "grace",
      reason: "You asked to be reminded today.",
      reminder: { note: "about the lease" },
      status: "pending",
    });
    expect(after.entries.slice(1).map((e) => e.id)).toEqual(
      first.entries.map((e) => e.id),
    );
    expect(contact("grace")).toMatchObject({ dueOn: null, dueNote: null });
    expect(after.upcoming).toEqual([]);
    // Reloading keeps exactly one row for her and does not top up past six.
    const again = await getCallSheet("u", now);
    expect(again.entries).toHaveLength(6);
    expect(again.entries.filter((e) => e.personId === "grace")).toHaveLength(1);
    expect(again.day.version).toBe(after.day.version);
  });

  it("counts reminders toward the five on a new day", async () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) addPerson(id);
    db.tx.interaction.findMany = async () =>
      [
        {
          personIds: ["a", "b", "c", "d", "e", "f"],
          occurredAt: new Date("2026-01-01T00:00:00Z"),
        },
      ] as never;
    addPerson("grace", { firstName: "Grace", lastName: "Kotick" });
    // Set without loading a sheet, so nobody is in the 7-day cooldown.
    await db.tx.callSheetContact.upsert({
      where: { userId_personId: { userId: "u", personId: "grace" } },
      create: { personId: "grace", userId: "u", identityKey: "x", dueOn: "2026-09-29" },
      update: {},
    });
    const tomorrow = await getCallSheet("u", new Date("2026-09-29T16:00:00Z"));
    expect(tomorrow.entries).toHaveLength(5);
    expect(tomorrow.entries[0].personId).toBe("grace");
  });

  it("keeps the reminder reason when contact data is unreliable, and fires late after a missed day", async () => {
    addPerson("grace", { firstName: "Grace", lastName: "Kotick" });
    await getCallSheet("u", new Date("2026-09-20T16:00:00Z"));
    await db.tx.callSheetContact.upsert({
      where: { userId_personId: { userId: "u", personId: "grace" } },
      create: { personId: "grace", userId: "u", identityKey: "x", dueOn: "2026-09-22" },
      update: { dueOn: "2026-09-22", dueNote: null },
    });
    // The user did not open the app on the 22nd; it fires on the 28th.
    const late = await getCallSheet("u", now);
    expect(late.entries).toHaveLength(1);
    expect(late.entries[0]).toMatchObject({
      personId: "grace",
      reason: "You asked to be reminded today.",
      reminder: { note: null },
    });
    const later = await getCallSheet("u", new Date(now.getTime() + 3_600_000));
    expect(later.entries[0].reason).toBe("You asked to be reminded today.");
    // The next day it does not come back on its own.
    const next = await getCallSheet("u", new Date("2026-09-29T16:00:00Z"));
    expect(next.entries).toEqual([]);
  });

  it("re-issues a fired reminder row when the person's name is edited that day", async () => {
    addPerson("grace", { firstName: "Grace", lastName: null });
    await setCallSheetReminder(
      "u",
      { personId: "grace", dueOn: "2026-09-28", note: "lease" },
      now,
    );
    db.state.people[0].lastName = "Kotick";
    const sheet = await getCallSheet("u", now);
    expect(sheet.entries).toHaveLength(1);
    expect(sheet.entries[0]).toMatchObject({
      name: "Grace Kotick",
      reminder: { note: "lease" },
    });
  });

  it("wins over an earlier 'someone else today' on the same day", async () => {
    addPerson("grace", { firstName: "Grace", lastName: "Kotick" });
    await getCallSheet("u", now);
    const day = db.state.days[0];
    day.entries = { entries: [], skipped: ["grace"] };
    const sheet = await setCallSheetReminder(
      "u",
      { personId: "grace", dueOn: "2026-09-28" },
      now,
    );
    expect(sheet.entries.map((e) => e.personId)).toEqual(["grace"]);
    expect((db.state.days[0].entries as { skipped: string[] }).skipped).toEqual([]);
  });
});
