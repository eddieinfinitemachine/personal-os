import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  BATCH_SIZE, CONTACTS_JXA, BIRTHDAY_BATCH_SIZE, BIRTHDAY_RESEND_MS, BULK_LIMIT, LOOKBACK_MS, birthdaySummaryLine, parseFlags, parseSince, readBirthdayState, readCheckpoint,
  selectNewCards, summaryLine, syncContactBirthdays, syncContactsToCrm, toContactCards,
  type BirthdayState, type Checkpoint, type ContactCard, type Flags, type PostResult,
} from "./contacts-crm-sync";

const now = new Date("2026-09-29T12:00:00Z");
const flags = (extra: Partial<Flags> = {}): Flags => ({ dryRun: false, verbose: false, since: null, ...extra });
const card = (id: string, creationDate: string, extra: Partial<ContactCard> = {}): ContactCard => ({
  id, firstName: "Avery", lastName: "Example", organization: "", phones: ["+15551234567"], emails: [], creationDate, modificationDate: null, birthday: null, ...extra,
});
const checkpoint = (extra: Partial<Checkpoint> = {}): Checkpoint => ({ version: 1, since: "2026-09-29T10:00:00.000Z", floor: "2026-09-20T00:00:00.000Z", posted: {}, ...extra });
const ok = (people: object[]): PostResult => ({
  created: people.map((p) => ({ cardId: (p as { cardId: string }).cardId, personId: "p-" + (p as { cardId: string }).cardId })),
  skipped: [],
});
const run = (extra: Partial<Parameters<typeof syncContactsToCrm>[0]>) => {
  const post = vi.fn(async (people: object[]) => ok(people));
  const save = vi.fn(async (_c: Checkpoint) => {});
  const cards = [card("old", "2026-09-01T00:00:00Z"), card("new1", "2026-09-29T11:00:00Z"), card("new2", "2026-09-29T11:30:00Z")];
  const exportCards = vi.fn(async () => cards);
  const promise = syncContactsToCrm({ exportCards, post, save, checkpoint: checkpoint(), flags: flags(), now, log: () => {}, ...extra });
  return { promise, post, save, exportCards };
};

describe("parseFlags", () => {
  it("parses flags and --since formats", () => {
    expect(parseFlags(["--dry-run", "--verbose"])).toEqual({ dryRun: true, verbose: true, since: null });
    expect(parseFlags(["--since", "2026-09-01T00:00:00Z"]).since).toBe("2026-09-01T00:00:00.000Z");
    expect(parseFlags(["--since=2026-09-01"]).since).toBe(new Date(2026, 8, 1).toISOString());
    expect(() => parseFlags(["--since", "soon"])).toThrow();
    expect(() => parseFlags(["--since"])).toThrow();
    expect(() => parseFlags(["--bogus"])).toThrow();
    expect(parseSince("2026-09-29")).toBe(new Date(2026, 8, 29).toISOString());
  });
});

describe("readCheckpoint", () => {
  it("accepts only a valid v1 checkpoint", () => {
    expect(readCheckpoint(checkpoint())).toEqual(checkpoint());
    for (const bad of [null, {}, { version: 2, since: now.toISOString(), posted: {} }, { version: 1, since: "x", posted: {} }, { version: 1, since: now.toISOString(), posted: [] }]) expect(readCheckpoint(bad)).toBeNull();
  });
});

describe("toContactCards", () => {
  it("orders mobile numbers first and drops untrackable rows", () => {
    const cards = toContactCards([
      { id: "a", firstName: "Avery", lastName: "", organization: "", phones: ["+15550000001", "+15550000002"], phoneLabels: ["_$!<Home>!$_", "_$!<Mobile>!$_"], emails: ["a@example.com"], creationDate: "2026-09-29T00:00:00.000Z", modificationDate: null },
      { id: "", creationDate: "2026-09-29T00:00:00.000Z" },
      { id: "b", creationDate: null },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].phones).toEqual(["+15550000002", "+15550000001"]);
    expect(() => toContactCards({})).toThrow();
  });
});

describe("selectNewCards", () => {
  it("selects cards after since (with lookback, never before floor) that were not posted, oldest first", () => {
    const cards = [
      card("b", "2026-09-29T11:00:00Z"), card("a", "2026-09-29T10:30:00Z"), card("late", "2026-09-28T12:00:00Z"),
      card("posted", "2026-09-29T11:00:00Z"), card("prefloor", "2026-09-19T00:00:00Z"),
    ];
    expect(selectNewCards(cards, checkpoint({ posted: { posted: "2026-09-29T11:00:00Z" } })).map((c) => c.id)).toEqual(["late", "a", "b"]);
    expect(selectNewCards(cards, checkpoint({ floor: "2026-09-29T10:00:00.000Z" })).map((c) => c.id)).toEqual(["a", "b", "posted"]);
    const beyond = new Date(Date.parse("2026-09-29T10:00:00Z") - LOOKBACK_MS - 1000).toISOString();
    expect(selectNewCards([card("x", beyond)], checkpoint({ floor: undefined }))).toEqual([]);
  });
});

describe("syncContactsToCrm", () => {
  it("first run with no checkpoint records now and posts nothing", async () => {
    const { promise, post, save, exportCards } = run({ checkpoint: null });
    const summary = await promise;
    expect(summary.firstRun).toBe(true);
    expect(post).not.toHaveBeenCalled();
    expect(exportCards).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith({ version: 1, since: now.toISOString(), floor: now.toISOString(), posted: {} });
    expect(summaryLine(summary, false)).toContain("first run");
  });

  it("first run with --since posts cards created after it", async () => {
    const { promise, post, save } = run({ checkpoint: null, flags: flags({ since: "2026-08-01T00:00:00.000Z" }) });
    const summary = await promise;
    expect(post.mock.calls[0][0].map((p) => (p as { cardId: string }).cardId)).toEqual(["old", "new1", "new2"]);
    expect(summary.created).toBe(3);
    const saved = save.mock.calls[0][0];
    expect(saved.since).toBe("2026-09-29T11:30:00.000Z");
    expect(saved.floor).toBe("2026-08-01T00:00:00.000Z");
    expect(Object.keys(saved.posted).sort()).toEqual(["new1", "new2"]); // "old" is behind the lookback window: pruned
  });

  it("posts new cards in the server's shape, records them and advances since", async () => {
    const log = vi.fn();
    const { promise, post, save } = run({ flags: flags({ verbose: true }), log });
    const summary = await promise;
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0][0]).toEqual({ cardId: "new1", firstName: "Avery", lastName: "Example", company: null, phones: ["+15551234567"], emails: [], createdAt: "2026-09-29T11:00:00Z", birthday: null });
    expect(summary).toMatchObject({ cards: 3, selected: 2, created: 2, skipped: 0 });
    expect(save).toHaveBeenCalledWith({ version: 1, since: "2026-09-29T11:30:00.000Z", floor: "2026-09-20T00:00:00.000Z", posted: { new1: "2026-09-29T11:00:00Z", new2: "2026-09-29T11:30:00Z" } });
    expect(log.mock.calls.map((c) => c[0])).toEqual(["new1 created", "new2 created"]);
  });

  it("records server-skipped cards as handled", async () => {
    const post = vi.fn(async (people: object[]) => ({ created: [], skipped: people.map((p) => ({ cardId: (p as { cardId: string }).cardId, reason: "phone-match" })) }));
    const { promise, save } = run({ post });
    expect((await promise).skipped).toBe(2);
    expect(Object.keys(save.mock.calls[0][0].posted)).toEqual(["new1", "new2"]);
  });

  it("treats a burst of new cards as an import: posts nothing and moves the floor past them", async () => {
    const burst = Array.from({ length: BULK_LIMIT + 1 }, (_, i) => card(`c${i}`, new Date(Date.parse("2026-09-29T10:00:00Z") + (i + 1) * 1000).toISOString()));
    const { promise, post, save } = run({ exportCards: async () => burst });
    const summary = await promise;
    expect(summary.bulk).toBe(true);
    expect(post).not.toHaveBeenCalled();
    const newest = burst.at(-1)!.creationDate;
    expect(save).toHaveBeenCalledWith({ version: 1, since: newest, floor: newest, posted: {} });
    expect(selectNewCards(burst, save.mock.calls[0][0])).toEqual([]);
    expect(summaryLine(summary, false)).toContain("--since");
    const dry = run({ exportCards: async () => burst, flags: flags({ dryRun: true }) });
    expect((await dry.promise).bulk).toBe(true);
    expect(dry.save).not.toHaveBeenCalled();
  });

  it("batches by 50 (an explicit --since bypasses the import guard)", async () => {
    const many = Array.from({ length: BATCH_SIZE + 5 }, (_, i) => card(`c${i}`, new Date(Date.parse("2026-09-29T10:00:00Z") + (i + 1) * 1000).toISOString()));
    const { promise, post } = run({ exportCards: async () => many, flags: flags({ since: "2026-09-29T10:00:00.000Z" }) });
    await promise;
    expect(post.mock.calls.map((c) => c[0].length)).toEqual([BATCH_SIZE, 5]);
  });

  it("dry run posts and saves nothing", async () => {
    const log = vi.fn();
    const { promise, post, save } = run({ flags: flags({ dryRun: true, verbose: true }), log });
    const summary = await promise;
    expect(summary.wouldPost).toBe(2);
    expect(post).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(log.mock.calls.map((c) => c[0])).toEqual(["new1 would-post", "new2 would-post"]);
    const first = run({ checkpoint: null, flags: flags({ dryRun: true }) });
    await first.promise;
    expect(first.save).not.toHaveBeenCalled();
  });

  it("does not advance the checkpoint when a request fails", async () => {
    const many = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => card(`c${i}`, new Date(Date.parse("2026-09-29T10:00:00Z") + (i + 1) * 1000).toISOString()));
    const post = vi.fn(async (people: object[]) => { if (post.mock.calls.length > 1) throw new Error("Contacts CRM request failed (502)"); return ok(people); });
    const { promise, save } = run({ exportCards: async () => many, post, flags: flags({ since: "2026-09-29T10:00:00.000Z" }) });
    await expect(promise).rejects.toThrow("502");
    expect(save).not.toHaveBeenCalled();
  });

  it("with a checkpoint, --since re-scans from an earlier date without repeating posted cards", async () => {
    const { promise, post, save } = run({ checkpoint: checkpoint({ posted: { new1: "2026-09-29T11:00:00Z" } }), flags: flags({ since: "2026-08-01T00:00:00.000Z" }) });
    await promise;
    expect(post.mock.calls[0][0].map((p) => (p as { cardId: string }).cardId)).toEqual(["old", "new2"]);
    expect(save.mock.calls[0][0].floor).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("Contacts birthdays", () => {
  it("toContactCards keeps a real birthday (yearless 1604 included) and drops anything else", () => {
    const row = (birthday: unknown) => ({ id: "a", firstName: "Avery", phones: [], emails: [], creationDate: "2026-09-29T00:00:00.000Z", birthday });
    expect(toContactCards([row("1990-03-05"), row("1604-02-29"), row("2026-02-29"), row(null), row("1990-3-5")]).map((c) => c.birthday))
      .toEqual(["1990-03-05", "1604-02-29", null, null, null]);
  });

  it("the Contacts export reads birth dates as local calendar dates and survives without them", () => {
    const list = <T,>(values: T[]) => () => values;
    const people = (birthDate: () => unknown) => ({
      id: list(["a", "b", "c"]), firstName: list(["Avery", "Blake", ""]), lastName: list(["", "", ""]), organization: list(["", "", ""]),
      phones: { value: list([[], [], []]), label: list([[], [], []]) }, emails: { value: list([[], [], []]) },
      creationDate: list([new Date("2026-09-29T00:00:00Z"), new Date("2026-09-29T00:00:00Z"), null]), modificationDate: list([null, null, null]),
      birthDate,
    });
    const run = (birthDate: () => unknown) =>
      toContactCards(JSON.parse(runInNewContext(CONTACTS_JXA, { Application: () => ({ people: people(birthDate) }), Date }) as string));
    // Local midnight and local noon both read as the date Contacts shows.
    expect(run(list([new Date(1990, 2, 5), new Date(1604, 6, 14, 12)])).map((c) => c.birthday)).toEqual(["1990-03-05", "1604-07-14"]);
    expect(run(list([null, undefined])).map((c) => c.birthday)).toEqual([null, null]);
    expect(run(() => { throw new Error("birth date unavailable"); }).map((c) => [c.id, c.birthday])).toEqual([["a", null], ["b", null]]);
  });

  it("posts new cards with their birthday", async () => {
    const cards = [card("new1", "2026-09-29T11:00:00Z", { birthday: "1990-03-05" })];
    const { promise, post } = run({ exportCards: async () => cards });
    await promise;
    expect(post.mock.calls[0][0][0]).toMatchObject({ cardId: "new1", birthday: "1990-03-05" });
  });

  const birthdays = (extra: Partial<Parameters<typeof syncContactBirthdays>[0]> = {}) => {
    const post = vi.fn(async (sent: object[]) => ({ filled: sent.length, alreadySet: 0, unmatched: 0, ambiguous: 0, conflicting: 0 }));
    const save = vi.fn<(state: BirthdayState) => Promise<void>>(async () => {});
    const cards = [
      card("b", "2026-01-01T00:00:00Z", { birthday: "1604-07-14", phones: [], emails: ["b@example.com"] }),
      card("a", "2026-01-01T00:00:00Z", { birthday: "1990-03-05" }),
      card("none", "2026-01-01T00:00:00Z"),
      card("unreachable", "2026-01-01T00:00:00Z", { birthday: "1991-04-06", phones: [], emails: [] }),
    ];
    const promise = syncContactBirthdays({ exportCards: async () => cards, post, save, state: null, flags: flags(), now, ...extra });
    return { promise, post, save };
  };

  it("sends every card with a birthday and a handle, in card order, and records what it sent", async () => {
    const { promise, post, save } = birthdays();
    const summary = await promise;
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toEqual([
      { cardId: "a", phones: ["+15551234567"], emails: [], birthday: "1990-03-05" },
      { cardId: "b", phones: [], emails: ["b@example.com"], birthday: "1604-07-14" },
    ]);
    expect(summary).toMatchObject({ cards: 2, sent: 2, filled: 2, unchanged: false });
    expect(save).toHaveBeenCalledWith({ version: 1, digest: expect.stringMatching(/^[0-9a-f]{64}$/), sentAt: now.toISOString() });
    expect(birthdaySummaryLine(summary, false)).toBe("Contacts birthdays: 2 sent, 2 filled, 0 already set, 0 unmatched, 0 ambiguous, 0 conflicting");
  });

  it("skips unchanged birthdays for a day, then sends again; any change sends at once", async () => {
    const first = birthdays();
    await first.promise;
    const state = first.save.mock.calls[0][0];
    const same = birthdays({ state, now: new Date(now.getTime() + BIRTHDAY_RESEND_MS - 1) });
    const summary = await same.promise;
    expect(summary.unchanged).toBe(true);
    expect(same.post).not.toHaveBeenCalled();
    expect(same.save).not.toHaveBeenCalled();
    expect(birthdaySummaryLine(summary, false)).toContain("unchanged");
    const daily = birthdays({ state, now: new Date(now.getTime() + BIRTHDAY_RESEND_MS) });
    await daily.promise;
    expect(daily.post).toHaveBeenCalledTimes(1);
    const changed = birthdays({ state, exportCards: async () => [card("a", "2026-01-01T00:00:00Z", { birthday: "1990-03-06" })] });
    await changed.promise;
    expect(changed.post).toHaveBeenCalledTimes(1);
  });

  it("batches by the server cap, and a failed request saves nothing", async () => {
    const many = Array.from({ length: BIRTHDAY_BATCH_SIZE + 3 }, (_, i) => card(`c${String(i).padStart(3, "0")}`, "2026-01-01T00:00:00Z", { birthday: "1990-03-05" }));
    const ok = birthdays({ exportCards: async () => many });
    await ok.promise;
    expect(ok.post.mock.calls.map((c) => c[0].length)).toEqual([BIRTHDAY_BATCH_SIZE, 3]);
    const post = vi.fn(async () => { throw new Error("Contacts CRM request failed (502)"); });
    const failing = birthdays({ post });
    await expect(failing.promise).rejects.toThrow("502");
    expect(failing.save).not.toHaveBeenCalled();
  });

  it("dry run sends and saves nothing", async () => {
    const { promise, post, save } = birthdays({ flags: flags({ dryRun: true }) });
    const summary = await promise;
    expect(summary.wouldSend).toBe(2);
    expect(post).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(birthdaySummaryLine(summary, true)).toBe("Contacts birthdays (dry run): 2 cards would be sent");
  });

  it("reads only a valid birthday state", () => {
    expect(readBirthdayState({ version: 1, digest: "d", sentAt: now.toISOString() })).toEqual({ version: 1, digest: "d", sentAt: now.toISOString() });
    for (const bad of [null, {}, { version: 2, digest: "d", sentAt: now.toISOString() }, { version: 1, digest: "d", sentAt: "x" }]) expect(readBirthdayState(bad)).toBeNull();
  });
});
