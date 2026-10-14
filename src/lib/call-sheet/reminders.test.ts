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
    addPerson("alex");
    await expect(
      setCallSheetReminder("u", { personId: "alex", dueOn: "2026-09-27" }, now),
    ).rejects.toThrow("already passed");
    await expect(
      setCallSheetReminder("u", { personId: "alex", dueOn: "2028-09-28" }, now),
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
    addPerson("alex", { firstName: "Alex", lastName: "Rivera", manualAt: null });
    db.tx.callSheetContact.upsert({
      where: { userId_personId: { userId: "u", personId: "alex" } },
      create: {
        personId: "alex",
        userId: "u",
        identityKey: "x",
        excludedAt: now,
        snoozedUntil: new Date("2026-12-01"),
      },
      update: {},
    });
    const set = await setCallSheetReminder(
      "u",
      { personId: "alex", dueOn: "2026-10-06", note: "the lease" },
      now,
    );
    expect(set.upcoming).toEqual([
      { personId: "alex", name: "Alex Rivera", dueOn: "2026-10-06", note: "the lease" },
    ]);
    expect(set.entries.some((e) => e.personId === "alex")).toBe(false);
    expect(contact("alex")).toMatchObject({
      dueOn: "2026-10-06",
      dueNote: "the lease",
      excludedAt: null,
      snoozedUntil: null,
    });
    const cancelled = await setCallSheetReminder(
      "u",
      { personId: "alex", dueOn: null },
      now,
    );
    expect(cancelled.upcoming).toEqual([]);
    expect(contact("alex")).toMatchObject({ dueOn: null, dueNote: null });
  });

  it("adds a reminder due today to a full day as a sixth row on top, once", async () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) addPerson(id);
    // a–f have an old saved check-in, so the first sheet fills to five; Alex
    // has no history at all, so she would never be suggested on her own.
    db.tx.interaction.findMany = async () =>
      [
        {
          personIds: ["a", "b", "c", "d", "e", "f"],
          occurredAt: new Date("2026-01-01T00:00:00Z"),
        },
      ] as never;
    addPerson("alex", { firstName: "Alex", lastName: "Rivera" });
    const first = await getCallSheet("u", now);
    expect(first.entries).toHaveLength(5);
    expect(first.entries.some((e) => e.personId === "alex")).toBe(false);
    const after = await setCallSheetReminder(
      "u",
      { personId: "alex", dueOn: "2026-09-28", note: "about the lease" },
      now,
    );
    expect(after.entries).toHaveLength(6);
    expect(after.entries[0]).toMatchObject({
      personId: "alex",
      reason: "You asked to be reminded today.",
      reminder: { note: "about the lease" },
      status: "pending",
    });
    expect(after.entries.slice(1).map((e) => e.id)).toEqual(
      first.entries.map((e) => e.id),
    );
    expect(contact("alex")).toMatchObject({ dueOn: null, dueNote: null });
    expect(after.upcoming).toEqual([]);
    // Reloading keeps exactly one row for her and does not top up past six.
    const again = await getCallSheet("u", now);
    expect(again.entries).toHaveLength(6);
    expect(again.entries.filter((e) => e.personId === "alex")).toHaveLength(1);
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
    addPerson("alex", { firstName: "Alex", lastName: "Rivera" });
    // Set without loading a sheet, so nobody is in the 7-day cooldown.
    await db.tx.callSheetContact.upsert({
      where: { userId_personId: { userId: "u", personId: "alex" } },
      create: { personId: "alex", userId: "u", identityKey: "x", dueOn: "2026-09-29" },
      update: {},
    });
    const tomorrow = await getCallSheet("u", new Date("2026-09-29T16:00:00Z"));
    expect(tomorrow.entries).toHaveLength(5);
    expect(tomorrow.entries[0].personId).toBe("alex");
  });

  it("keeps the reminder reason when contact data is unreliable, and fires late after a missed day", async () => {
    addPerson("alex", { firstName: "Alex", lastName: "Rivera" });
    await getCallSheet("u", new Date("2026-09-20T16:00:00Z"));
    await db.tx.callSheetContact.upsert({
      where: { userId_personId: { userId: "u", personId: "alex" } },
      create: { personId: "alex", userId: "u", identityKey: "x", dueOn: "2026-09-22" },
      update: { dueOn: "2026-09-22", dueNote: null },
    });
    // The user did not open the app on the 22nd; it fires on the 28th.
    const late = await getCallSheet("u", now);
    expect(late.entries).toHaveLength(1);
    expect(late.entries[0]).toMatchObject({
      personId: "alex",
      reason: "You asked to be reminded today.",
      reminder: { note: null },
    });
    const later = await getCallSheet("u", new Date(now.getTime() + 3_600_000));
    expect(later.entries[0].reason).toBe("You asked to be reminded today.");
    // Not acted on: the row is kept, and says when it was asked for.
    const next = await getCallSheet("u", new Date("2026-09-29T16:00:00Z"));
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({
      personId: "alex",
      reason: "You asked to be reminded yesterday.",
      reminder: { note: null },
      carriedFrom: "2026-09-28",
    });
    expect(next.entries[0].id).not.toBe(late.entries[0].id);
    const twoDays = await getCallSheet("u", new Date("2026-09-30T16:00:00Z"));
    expect(twoDays.entries[0]).toMatchObject({
      reason: "You asked to be reminded on Monday.",
      carriedFrom: "2026-09-28",
    });
    const week = await getCallSheet("u", new Date("2026-10-06T16:00:00Z"));
    expect(week.entries[0].reason).toBe("You asked to be reminded on Sep 28.");
  });

  it("re-issues a fired reminder row when the person's name is edited that day", async () => {
    addPerson("alex", { firstName: "Alex", lastName: null });
    await setCallSheetReminder(
      "u",
      { personId: "alex", dueOn: "2026-09-28", note: "lease" },
      now,
    );
    db.state.people[0].lastName = "Rivera";
    const sheet = await getCallSheet("u", now);
    expect(sheet.entries).toHaveLength(1);
    expect(sheet.entries[0]).toMatchObject({
      name: "Alex Rivera",
      reminder: { note: "lease" },
    });
  });

  it("wins over an earlier 'someone else today' on the same day", async () => {
    addPerson("alex", { firstName: "Alex", lastName: "Rivera" });
    await getCallSheet("u", now);
    const day = db.state.days[0];
    day.entries = { entries: [], skipped: ["alex"] };
    const sheet = await setCallSheetReminder(
      "u",
      { personId: "alex", dueOn: "2026-09-28" },
      now,
    );
    expect(sheet.entries.map((e) => e.personId)).toEqual(["alex"]);
    expect((db.state.days[0].entries as { skipped: string[] }).skipped).toEqual([]);
  });
});

describe("birthdays on the sheet", () => {
  const born = (date: string) => new Date(`${date}T00:00:00.000Z`);
  const overdue = (...ids: string[]) =>
    (async () =>
      [
        { personIds: ids, occurredAt: new Date("2026-01-01T00:00:00Z") },
      ]) as never;
  it("adds a birthday today to a full day in its own section, even when snoozed", async () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) addPerson(id);
    db.tx.interaction.findMany = overdue("a", "b", "c", "d", "e", "f");
    addPerson("bea", { firstName: "Bea", lastName: "Day" });
    const first = await getCallSheet("u", now);
    expect(first.entries).toHaveLength(5);
    expect(first.birthdays).toEqual([]);
    await db.tx.callSheetContact.upsert({
      where: { userId_personId: { userId: "u", personId: "bea" } },
      create: {
        personId: "bea",
        userId: "u",
        identityKey: "x",
        snoozedUntil: new Date("2026-12-01T00:00:00Z"),
        lastSuggestedAt: now,
      },
      update: {},
    });
    db.state.people.find((p) => p.id === "bea")!.birthday = born("1990-09-28");
    const after = await getCallSheet("u", now);
    expect(after.entries).toHaveLength(6);
    expect(after.entries[0]).toMatchObject({
      personId: "bea",
      reason: "It’s their birthday today.",
      birthday: "2026-09-28",
      section: "birthday",
      status: "pending",
    });
    // The regular five stay as they were.
    expect(after.entries.slice(1).map((e) => e.id)).toEqual(
      first.entries.map((e) => e.id),
    );
    expect(after.entries.slice(1).every((e) => !e.section)).toBe(true);
    const again = await getCallSheet("u", now);
    expect(again.day.version).toBe(after.day.version);
    expect(again.entries.filter((e) => e.personId === "bea")).toHaveLength(1);
  });

  it("on a new day sits beside the five, and a birthday later this week is only listed", async () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) addPerson(id);
    db.tx.interaction.findMany = overdue("a", "b", "c", "d", "e", "f");
    addPerson("alex", { firstName: "Alex", lastName: "Rivera" });
    await db.tx.callSheetContact.upsert({
      where: { userId_personId: { userId: "u", personId: "alex" } },
      create: { personId: "alex", userId: "u", identityKey: "x", dueOn: "2026-09-28" },
      update: {},
    });
    addPerson("bea", { firstName: "Bea", lastName: "Day", birthday: born("1990-09-28") });
    addPerson("cal", { firstName: "Cal", lastName: "Soon", birthday: born("1990-10-01") });
    addPerson("dee", { firstName: "Dee", lastName: "Far", birthday: born("1604-10-12") });
    addPerson("eve", { firstName: "Eve", lastName: "Out", birthday: born("1990-10-13") });
    addPerson("hid", { firstName: "Hid", lastName: "Den", birthday: born("1990-09-30") });
    await db.tx.callSheetContact.upsert({
      where: { userId_personId: { userId: "u", personId: "hid" } },
      create: { personId: "hid", userId: "u", identityKey: "x", excludedAt: now },
      update: {},
    });
    const sheet = await getCallSheet("u", now);
    // Alex's reminder plus four regulars make the five; Bea's birthday is
    // extra, and Cal's (Thursday) earns no row of its own.
    expect(sheet.entries.map((e) => e.personId)).toEqual([
      "alex",
      "bea",
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(sheet.entries[0].section).toBeUndefined();
    expect(sheet.entries[1]).toMatchObject({
      reason: "It’s their birthday today.",
      birthday: "2026-09-28",
      section: "birthday",
    });
    expect(sheet.entries[2].birthday).toBeUndefined();
    expect(sheet.birthdays).toEqual([
      { personId: "cal", name: "Cal Soon", on: "2026-10-01" },
      { personId: "dee", name: "Dee Far", on: "2026-10-12" },
    ]);
  });

  it("a reminder on their birthday is one row, in the list, with the birthday", async () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) addPerson(id);
    db.tx.interaction.findMany = overdue("a", "b", "c", "d", "e", "f");
    addPerson("bea", { firstName: "Bea", lastName: "Day", birthday: born("1990-09-28") });
    await db.tx.callSheetContact.upsert({
      where: { userId_personId: { userId: "u", personId: "bea" } },
      create: { personId: "bea", userId: "u", identityKey: "x", dueOn: "2026-09-28", dueNote: "cake" },
      update: {},
    });
    const sheet = await getCallSheet("u", now);
    expect(sheet.entries.map((e) => e.personId)).toEqual(["bea", "a", "b", "c", "d"]);
    expect(sheet.entries[0]).toMatchObject({
      reason: "You asked to be reminded today.",
      reminder: { note: "cake" },
      birthday: "2026-09-28",
    });
    expect(sheet.entries.some((e) => e.section)).toBe(false);
  });

  it("a reminder that fires for a birthday row moves it into the list", async () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) addPerson(id);
    db.tx.interaction.findMany = overdue("a", "b", "c", "d", "e", "f");
    addPerson("bea", { birthday: born("1990-09-28") });
    const first = await getCallSheet("u", now);
    expect(first.entries).toHaveLength(6);
    expect(first.entries[0]).toMatchObject({ personId: "bea", section: "birthday" });
    await setCallSheetReminder("u", { personId: "bea", dueOn: "2026-09-28" }, now);
    const after = await getCallSheet("u", now);
    // Same six rows (none are dropped mid-day): Bea is now the reminder row.
    expect(after.entries.map((e) => e.id)).toEqual(first.entries.map((e) => e.id));
    expect(after.entries[0]).toMatchObject({
      reason: "You asked to be reminded today.",
      birthday: "2026-09-28",
    });
    expect(after.entries.some((e) => e.section)).toBe(false);
  });

  it("stays off for the day once set aside", async () => {
    addPerson("bea", { birthday: born("1990-09-28") });
    expect((await getCallSheet("u", now)).entries.map((e) => e.personId)).toEqual(["bea"]);
    db.state.days[0].entries = { entries: [], skipped: ["bea"] };
    expect((await getCallSheet("u", now)).entries).toEqual([]);
  });

  it("only contact made on the day counts, and earlier contact never swaps the row out", async () => {
    addPerson("bea", { birthday: born("1990-09-28") });
    const first = await getCallSheet("u", now);
    expect(first.entries[0]).toMatchObject({ personId: "bea", status: "pending" });
    // A sync after the sheet was made finds yesterday's chat: still her birthday.
    db.tx.interaction.findMany = async () =>
      [{ personIds: ["bea"], occurredAt: new Date("2026-09-27T20:00:00Z") }] as never;
    const synced = await getCallSheet("u", now);
    expect(synced.entries).toHaveLength(1);
    expect(synced.entries[0]).toMatchObject({
      id: first.entries[0].id,
      status: "pending",
      reason: "It’s their birthday today.",
    });
    // A message this morning, before the sheet was opened, is the birthday wish.
    db.tx.interaction.findMany = async () =>
      [{ personIds: ["bea"], occurredAt: new Date("2026-09-28T09:00:00Z") }] as never;
    const wished = await getCallSheet("u", now);
    expect(wished.entries).toHaveLength(1);
    expect(wished.entries[0]).toMatchObject({
      id: first.entries[0].id,
      status: "contacted",
      reason: "You have been in touch today.",
      birthday: "2026-09-28",
    });
  });
});

describe("kept until done", () => {
  const overdue = (...ids: string[]) =>
    (async () =>
      [
        { personIds: ids, occurredAt: new Date("2026-01-01T00:00:00Z") },
      ]) as never;
  const stored = () =>
    db.state.days[db.state.days.length - 1].entries as {
      entries: { personId: string; status: string }[];
      skipped: string[];
    };
  const ids = (sheet: { entries: { personId: string }[] }) =>
    sheet.entries.map((e) => e.personId);

  it("carries pending rows into a new day, first, counted toward the five, until they are done", async () => {
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) addPerson(id);
    db.tx.interaction.findMany = overdue("a", "b", "c", "d", "e", "f", "g", "h");
    const monday = await getCallSheet("u", now);
    expect(ids(monday)).toEqual(["a", "b", "c", "d", "e"]);
    expect(monday.entries.some((e) => e.carriedFrom)).toBe(false);
    for (const entry of stored().entries) {
      if (entry.personId === "a") entry.status = "done";
      if (entry.personId === "b") entry.status = "contacted";
    }
    const tuesday = await getCallSheet("u", new Date("2026-09-29T16:00:00Z"));
    expect(ids(tuesday)).toEqual(["c", "d", "e", "f", "g"]);
    expect(tuesday.entries.map((e) => e.carriedFrom)).toEqual([
      "2026-09-28",
      "2026-09-28",
      "2026-09-28",
      undefined,
      undefined,
    ]);
    expect(tuesday.entries[0]).toMatchObject({
      status: "pending",
      reason: "Time for your 90-day check-in.",
    });
    expect(tuesday.entries[0].id).not.toBe(monday.entries[2].id);
    expect(db.state.days).toHaveLength(2);
    // Done on Tuesday; the app is next opened on Thursday.
    for (const entry of stored().entries)
      if (entry.personId === "c") entry.status = "done";
    const thursday = await getCallSheet("u", new Date("2026-10-01T16:00:00Z"));
    expect(ids(thursday)).toEqual(["d", "e", "f", "g", "h"]);
    expect(thursday.entries.map((e) => e.carriedFrom)).toEqual([
      "2026-09-28",
      "2026-09-28",
      "2026-09-29",
      "2026-09-29",
      undefined,
    ]);
    // Reading the same day again changes nothing.
    const again = await getCallSheet("u", new Date("2026-10-01T18:00:00Z"));
    expect(again.entries).toEqual(thursday.entries);
  });

  it("does not carry anyone contacted since, hidden, set aside, or given a later reminder", async () => {
    for (const id of ["a", "b", "c", "d"]) addPerson(id);
    db.tx.interaction.findMany = overdue("a", "b", "c", "d");
    expect(ids(await getCallSheet("u", now))).toEqual(["a", "b", "c", "d"]);
    // a: a chat after the row was made.
    db.tx.interaction.findMany = async () =>
      [
        { personIds: ["a"], occurredAt: new Date("2026-09-28T20:00:00Z") },
        {
          personIds: ["a", "b", "c", "d"],
          occurredAt: new Date("2026-01-01T00:00:00Z"),
        },
      ] as never;
    // b: "Don't suggest". c: a reminder for next week.
    Object.assign(contact("b")!, { excludedAt: now });
    Object.assign(contact("c")!, { dueOn: "2026-10-05", dueNote: "her trip" });
    // d: "Someone else today" took the row off and set them aside.
    const day = stored();
    day.entries = day.entries.filter((e) => e.personId !== "d");
    day.skipped = ["d"];
    const tuesday = await getCallSheet("u", new Date("2026-09-29T16:00:00Z"));
    expect(tuesday.entries).toEqual([]);
    expect(tuesday.upcoming.map((item) => item.personId)).toEqual(["c"]);
  });

  it("keeps a birthday row past the day, in the list, saying when it was", async () => {
    addPerson("bea", { firstName: "Bea", lastName: "Day", birthday: new Date("1990-09-28T00:00:00.000Z") });
    const birthday = await getCallSheet("u", now);
    expect(birthday.entries[0]).toMatchObject({ personId: "bea", section: "birthday" });
    const tuesday = await getCallSheet("u", new Date("2026-09-29T16:00:00Z"));
    expect(tuesday.entries).toHaveLength(1);
    expect(tuesday.entries[0]).toMatchObject({
      personId: "bea",
      status: "pending",
      reason: "Their birthday was yesterday.",
      carriedFrom: "2026-09-28",
    });
    expect(tuesday.entries[0].section).toBeUndefined();
    expect(tuesday.entries[0].birthday).toBeUndefined();
    const thursday = await getCallSheet("u", new Date("2026-10-01T16:00:00Z"));
    expect(thursday.entries[0].reason).toBe("Their birthday was on Monday.");
  });

  it("a reminder for today on a kept row makes it today's row", async () => {
    addPerson("a");
    db.tx.interaction.findMany = overdue("a");
    expect(ids(await getCallSheet("u", now))).toEqual(["a"]);
    Object.assign(contact("a")!, { dueOn: "2026-09-29", dueNote: "the lease" });
    const tuesday = await getCallSheet("u", new Date("2026-09-29T16:00:00Z"));
    expect(tuesday.entries).toHaveLength(1);
    expect(tuesday.entries[0]).toMatchObject({
      personId: "a",
      reason: "You asked to be reminded today.",
      reminder: { note: "the lease" },
    });
    expect(tuesday.entries[0].carriedFrom).toBeUndefined();
    expect(contact("a")!.dueOn).toBeNull();
    const later = await getCallSheet("u", new Date("2026-09-29T18:00:00Z"));
    expect(later.entries[0].reason).toBe("You asked to be reminded today.");
  });
});
