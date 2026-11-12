import { describe, expect, it, vi } from "vitest";
import { FIRST_CHECK_IN_NOTE, firstCheckIn, scheduleFirstCheckIn } from "./first-check-in";
import { identityKey } from "./policy";

describe("a new person's first check-in", () => {
  it("is the local date 30 days after you met, snoozed until that day starts", () => {
    // 11:45 pm on Nov 11 in New York is already Nov 12 in UTC.
    const when = firstCheckIn(new Date("2026-11-12T04:45:57Z"), "America/New_York");
    expect(when.dueOn).toBe("2026-12-11");
    expect(when.snoozedUntil.toISOString()).toBe("2026-12-11T05:00:00.000Z");
  });

  it("creates the preference with no cadence, and leaves an existing one alone", async () => {
    const upsert = vi.fn();
    const db = {
      callSheetSettings: { upsert: vi.fn().mockResolvedValue({ timezone: "America/New_York" }) },
      callSheetContact: { upsert },
    };
    const person = { id: "p", firstName: "Jay", lastName: "Roach", phone: "+13105550100", email: null };
    await scheduleFirstCheckIn(db as never, "owner", person, new Date("2026-11-12T04:45:57Z"));
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId_personId: { userId: "owner", personId: "p" } });
    expect(call.create).toMatchObject({ userId: "owner", personId: "p", identityKey: identityKey(person), dueOn: "2026-12-11", dueNote: FIRST_CHECK_IN_NOTE });
    expect(call.create.cadenceDays).toBeUndefined();
    expect(call.update).toEqual({});
  });

  it("falls back to now for a date that doesn't parse", async () => {
    const upsert = vi.fn();
    const db = { callSheetSettings: { upsert: vi.fn().mockResolvedValue({ timezone: "UTC" }) }, callSheetContact: { upsert } };
    await scheduleFirstCheckIn(db as never, "owner", { id: "p", firstName: "A", lastName: null, phone: null, email: null }, new Date("nope"));
    expect(upsert.mock.calls[0][0].create.dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
