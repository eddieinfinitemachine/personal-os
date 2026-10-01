import { describe, expect, it } from "vitest";
import {
  CASUAL_MESSAGE_VOLUME,
  CLOSE_MESSAGE_VOLUME,
  STRONG_MESSAGE_VOLUME,
  addLocalDays,
  cadence,
  closeness,
  identityKey,
  isLocalDate,
  latestContact,
  liveCues,
  limitPersonCues,
  localDate,
  messageVolume,
  rankCandidates,
  reviewQueue,
  selectCandidates,
  snoozeUntil,
  type PolicyPerson,
} from "./policy";
import type { SourceHealth } from "./types";
const now = new Date("2026-09-28T16:00:00Z");
const off: SourceHealth = {
  enabled: false,
  status: "not_connected",
  lastSuccessAt: null,
  error: null,
};
const sources = { imessage: off, whatsapp: off };
function person(id: string, extra: Partial<PolicyPerson> = {}): PolicyPerson {
  return {
    id,
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
    manualAt: new Date("2026-01-01T00:00:00Z"),
    sourceData: {},
    ...extra,
  };
}
describe("call sheet policy", () => {
  it("uses explicit timezone dates across midnight and DST", () => {
    expect(
      localDate(new Date("2026-09-28T02:00:00Z"), "America/New_York"),
    ).toBe("2026-09-27");
    expect(
      localDate(new Date("2026-03-08T07:00:00Z"), "America/New_York"),
    ).toBe("2026-03-08");
    expect(
      snoozeUntil(
        new Date("2026-03-07T15:00:00Z"),
        2,
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-03-09T04:00:00.000Z");
    expect(
      snoozeUntil(
        new Date("2026-10-31T15:00:00Z"),
        2,
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-11-02T05:00:00.000Z");
  });
  it("selects five deterministically independent of query order", () => {
    const list = ["g", "f", "e", "d", "c", "b", "a"].map((id) => person(id));
    const select = (items: PolicyPerson[]) =>
      selectCandidates(rankCandidates(items, sources, now, "UTC")).map(
        (item) => item.person.id,
      );
    expect(select(list)).toEqual(["a", "b", "c", "d", "e"]);
    expect(select(list.reverse())).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("never promotes unknown history or a stale source", () => {
    const p = person("a", {
      manualAt: null,
      sourceData: {
        imessage: {
          capturedAt: now.toISOString(),
          coverageStart: "2025-09-28T16:00:00Z",
          lastContactAt: "2026-01-01T00:00:00Z",
          messageCount: 1,
          cues: [],
          extractionPending: false,
        },
      },
    });
    expect(
      rankCandidates(
        [p, person("b", { manualAt: null })],
        {
          ...sources,
          imessage: {
            ...off,
            enabled: true,
            status: "ready",
            lastSuccessAt: "2026-09-20T00:00:00Z",
          },
        },
        now,
        "UTC",
      ),
    ).toEqual([]);
  });
  it("requires freshness for every enabled source and each person", () => {
    const health = {
      ...off,
      enabled: true,
      status: "ready" as const,
      lastSuccessAt: now.toISOString(),
    };
    const p = person("a", {
      manualAt: null,
      sourceData: {
        imessage: {
          capturedAt: now.toISOString(),
          coverageStart: "2025-09-28T16:00:00Z",
          lastContactAt: "2026-01-01T00:00:00Z",
          messageCount: 1,
          cues: [],
          extractionPending: false,
        },
      },
    });
    expect(
      rankCandidates([p], { imessage: health, whatsapp: health }, now, "UTC"),
    ).toEqual([]);
    expect(
      rankCandidates([p], { imessage: health, whatsapp: off }, now, "UTC"),
    ).toHaveLength(1);
    p.sourceData.imessage!.capturedAt = "2026-09-20T00:00:00Z";
    expect(
      rankCandidates([p], { imessage: health, whatsapp: off }, now, "UTC"),
    ).toEqual([]);
  });
  it("keeps trusting a fresh scan after a later attempt fails", () => {
    const failed = {
      ...off,
      enabled: true,
      status: "error" as const,
      lastSuccessAt: now.toISOString(),
      error: "The local source could not finish syncing.",
    };
    const p = person("a", {
      manualAt: null,
      sourceData: {
        imessage: {
          capturedAt: now.toISOString(),
          coverageStart: "2025-09-28T16:00:00Z",
          lastContactAt: "2026-01-01T00:00:00Z",
          messageCount: 1,
          cues: [],
          extractionPending: false,
        },
      },
    });
    expect(
      rankCandidates([p], { imessage: failed, whatsapp: off }, now, "UTC"),
    ).toHaveLength(1);
    expect(
      rankCandidates(
        [p],
        {
          imessage: { ...failed, lastSuccessAt: "2026-09-20T00:00:00Z" },
          whatsapp: off,
        },
        now,
        "UTC",
      ),
    ).toEqual([]);
  });
  it("recent direct evidence suppresses prompts even during partial sync", () => {
    const p = person("a", {
      sourceData: {
        imessage: {
          capturedAt: now.toISOString(),
          coverageStart: "2025-09-28T16:00:00Z",
          lastContactAt: "2026-09-27T00:00:00Z",
          messageCount: 1,
          cues: [],
          extractionPending: false,
        },
      },
    });
    expect(
      rankCandidates(
        [p],
        { ...sources, imessage: { ...off, enabled: true } },
        now,
        "UTC",
      ),
    ).toEqual([]);
    expect(
      latestContact(p, { ...sources, imessage: { ...off, enabled: true } }, now)
        .source,
    ).toBe("imessage");
  });
  it("uses overrides and suppresses recent manual encounters and cooldowns", () => {
    expect(cadence(person("a", { starred: true }), 120)).toBe(120);
    const preference = {
      cadenceDays: null,
      snoozedUntil: null,
      excludedAt: null,
      lastSuggestedAt: now,
      dueOn: null,
      dueNote: null,
    };
    expect(
      rankCandidates(
        [
          person("a", { manualAt: new Date("2026-09-27") }),
          person("b", { preference }),
        ],
        sources,
        now,
        "UTC",
      ),
    ).toEqual([]);
  });
  it("prioritizes imminent birthday and balances explicit circles", () => {
    const list = ["a", "b", "c", "d"].map((id) =>
      person(id, { circles: ["friends"] }),
    );
    list.push(
      person("family", { circles: ["family"] }),
      person("work", { circles: ["work"] }),
      person("birthday", { birthday: new Date("1990-09-29"), manualAt: null }),
    );
    const selected = selectCandidates(
      rankCandidates(list, sources, now, "UTC"),
    );
    expect(selected[0].person.id).toBe("birthday");
    expect(selected.filter((item) => item.category === "friends")).toHaveLength(
      2,
    );
    expect(selected.map((item) => item.person.id)).toEqual([
      "birthday",
      "a",
      "b",
      "family",
      "work",
    ]);
  });
  it("keeps possible grounded followups as context without bypassing cadence", () => {
    const p = person("a", {
      manualAt: null,
      sourceData: {
        imessage: {
          capturedAt: now.toISOString(),
          coverageStart: "2025-09-28T16:00:00Z",
          lastContactAt: "2026-09-10T00:00:00Z",
          messageCount: 1,
          extractionPending: false,
          cues: [
            {
              kind: "follow_up",
              text: "Ask about the trip",
              evidence: [
                {
                  source: "imessage",
                  messageId: "m",
                  sentAt: "2026-09-10T00:00:00Z",
                  excerpt: "trip",
                },
              ],
            },
          ],
        },
      },
    });
    const connected = {
      ...sources,
      imessage: {
        ...off,
        enabled: true,
        status: "ready" as const,
        lastSuccessAt: now.toISOString(),
      },
    };
    expect(rankCandidates([p], connected, now, "UTC")).toEqual([]);
    p.preference = {
      cadenceDays: 14,
      snoozedUntil: null,
      excludedAt: null,
      lastSuggestedAt: null,
      dueOn: null,
      dueNote: null,
    };
    const eligible = rankCandidates([p], connected, now, "UTC")[0];
    expect(eligible.reason).toBe("Time for your 14-day check-in.");
    expect(eligible.tier).toBe(3);
    expect(eligible.cues[0].kind).toBe("follow_up");
  });

  it("limits actual snippets across both sources with deterministic newest-first order", () => {
    const cue = (source: "imessage" | "whatsapp", day: number) => ({
      kind: "topic" as const,
      text: `${source} ${day}`,
      evidence: [
        {
          source,
          messageId: `${source}-${day}`,
          sentAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`,
          excerpt: `Snippet ${day}`,
        },
      ],
    });
    const metadata = {
      capturedAt: now.toISOString(),
      coverageStart: "2025-09-28T16:00:00.000Z",
      lastContactAt: "2026-09-26T00:00:00.000Z",
      messageCount: 3,
      extractionPending: false,
    };
    const data = {
      imessage: {
        ...metadata,
        cues: [cue("imessage", 1), cue("imessage", 25), cue("imessage", 20)],
      },
      whatsapp: {
        ...metadata,
        cues: [cue("whatsapp", 26), cue("whatsapp", 24), cue("whatsapp", 2)],
      },
    };
    const bounded = limitPersonCues(data, now);
    expect(bounded.imessage?.cues.map((c) => c.text)).toEqual(["imessage 25"]);
    expect(bounded.whatsapp?.cues.map((c) => c.text)).toEqual([
      "whatsapp 26",
      "whatsapp 24",
    ]);
    const all = [...data.imessage.cues, ...data.whatsapp.cues];
    expect(liveCues([...all].reverse(), now)).toEqual(liveCues(all, now));
    const multi = {
      ...cue("imessage", 28),
      evidence: [
        cue("imessage", 28).evidence[0],
        cue("imessage", 27).evidence[0],
      ],
    };
    const selected = liveCues([multi, ...all], now);
    expect(selected.flatMap((c) => c.evidence)).toHaveLength(3);
    expect(selected).toHaveLength(2);
  });
  it("hashes stable identity fields rather than interaction timestamps", () => {
    expect(identityKey(person("a"))).toBe(
      identityKey(person("a", { manualAt: now })),
    );
    expect(identityKey(person("a"))).not.toBe(
      identityKey(person("a", { phone: "+15555550101" })),
    );
  });
  it("maps CRM strength labels case-insensitively, close before friend", () => {
    const of = (strength: string | null) => closeness({ strength });
    expect(of("5 - family")).toBe("close");
    expect(of("4 - close friend")).toBe("close");
    expect(of("4 - Close Friend")).toBe("close");
    expect(of("3 - friend")).toBe("strong");
    expect(of("2 - acquaintance")).toBe("casual");
    expect(of("1 - met")).toBe("weak");
    expect(of("0 - don't know")).toBe("weak");
    expect(of("0 - don’t know")).toBe("weak");
    expect(of("close")).toBe("close");
    expect(of("STRONG")).toBe("strong");
    expect(of("casual")).toBe("casual");
    expect(of("weak")).toBe("weak");
    expect(of(null)).toBe("casual");
    expect(of("mystery")).toBe("casual");
  });
  it("reads message volume at the threshold boundaries", () => {
    const data = (imessage: number, whatsapp?: number) => {
      const base = {
        capturedAt: now.toISOString(),
        coverageStart: "2025-09-28T16:00:00Z",
        lastContactAt: null,
        cues: [],
        extractionPending: false,
      };
      return {
        imessage: { ...base, messageCount: imessage },
        ...(whatsapp === undefined
          ? {}
          : { whatsapp: { ...base, messageCount: whatsapp } }),
      };
    };
    expect(messageVolume(data(300, 200))).toBe(500);
    expect(messageVolume(data(5, Number.NaN))).toBe(5);
    expect(messageVolume(data(-3, 4))).toBe(4);
    expect(messageVolume(undefined)).toBe(0);
    expect([
      CLOSE_MESSAGE_VOLUME,
      STRONG_MESSAGE_VOLUME,
      CASUAL_MESSAGE_VOLUME,
    ]).toEqual([500, 150, 10]);
    const of = (count: number) =>
      closeness({ strength: null, sourceData: data(count) });
    expect(of(500)).toBe("close");
    expect(of(499)).toBe("strong");
    expect(of(150)).toBe("strong");
    expect(of(149)).toBe("casual");
    expect(of(10)).toBe("casual");
    expect(of(9)).toBe("weak");
    expect(of(1)).toBe("weak");
    expect(of(0)).toBe("casual");
    expect(closeness({ strength: null, sourceData: data(250, 250) })).toBe(
      "close",
    );
    // The closer of the two signals wins, in either direction.
    expect(closeness({ strength: "1 - met", sourceData: data(600) })).toBe(
      "close",
    );
    expect(
      closeness({ strength: "4 - close friend", sourceData: data(3) }),
    ).toBe("close");
    expect(closeness({ strength: "weak", sourceData: data(20) })).toBe(
      "casual",
    );
    expect(
      closeness({ strength: "2 - acquaintance", sourceData: data(0) }),
    ).toBe("casual");
    expect(
      cadence({ starred: false, strength: "4 - close friend", sourceData: {} }),
    ).toBe(30);
    expect(
      cadence({ starred: false, strength: "3 - friend", sourceData: {} }),
    ).toBe(60);
    expect(
      cadence({ starred: false, strength: "2 - acquaintance", sourceData: {} }),
    ).toBe(90);
    expect(
      cadence({ starred: false, strength: "1 - met", sourceData: {} }),
    ).toBe(180);
    expect(cadence({ starred: false, strength: null, sourceData: {} })).toBe(
      90,
    );
    expect(
      cadence({ starred: false, strength: null, sourceData: data(9) }),
    ).toBe(180);
    expect(
      cadence({ starred: false, strength: null, sourceData: data(200) }),
    ).toBe(60);
    expect(
      cadence({ starred: false, strength: "1 - met", sourceData: data(500) }),
    ).toBe(30);
    expect(
      cadence({ starred: true, strength: "1 - met", sourceData: {} }),
    ).toBe(30);
    expect(
      cadence(
        { starred: false, strength: "5 - family", sourceData: data(900) },
        200,
      ),
    ).toBe(200);
  });
  it("labelled close friends rank as important", () => {
    const [close, plain] = rankCandidates(
      [
        person("b", { strength: "4 - close friend" }),
        person("a", { strength: "2 - acquaintance" }),
      ],
      sources,
      now,
      "UTC",
    );
    expect(close).toMatchObject({ tier: 2, cadenceDays: 30 });
    expect(close.person.id).toBe("b");
    expect(plain).toMatchObject({ tier: 3, cadenceDays: 90 });
  });
  describe("people with no contact on record", () => {
    const connected = {
      ...sources,
      imessage: {
        ...off,
        enabled: true,
        status: "ready" as const,
        lastSuccessAt: now.toISOString(),
      },
    };
    const scanned = (
      lastContactAt: string | null,
      capturedAt = now.toISOString(),
    ) => ({
      imessage: {
        capturedAt,
        coverageStart: "2025-09-28T16:00:00Z",
        lastContactAt,
        messageCount: 0,
        cues: [],
        extractionPending: false,
      },
    });
    const silent = (id: string, extra: Partial<PolicyPerson> = {}) =>
      person(id, { manualAt: null, sourceData: scanned(null), ...extra });
    const preference = (extra = {}) => ({
      cadenceDays: null,
      snoozedUntil: null,
      excludedAt: null,
      lastSuggestedAt: null,
      dueOn: null,
      dueNote: null,
      ...extra,
    });
    it("joins after everyone with a known overdue date", () => {
      const ranked = rankCandidates(
        [
          silent("a"),
          person("z", {
            manualAt: null,
            sourceData: scanned("2026-01-01T00:00:00Z"),
          }),
        ],
        connected,
        now,
        "UTC",
      );
      expect(ranked.map((item) => item.person.id)).toEqual(["z", "a"]);
      expect(ranked[1]).toMatchObject({
        tier: 4,
        score: 0,
        reason: "No contact on record.",
        lastContactAt: null,
        lastContactSource: null,
      });
    });
    it("ranks starred or explicit-cadence silence as a year overdue", () => {
      const ranked = rankCandidates(
        [
          silent("plain"),
          silent("kept", { preference: preference({ cadenceDays: 180 }) }),
          silent("star", { starred: true }),
          person("known", {
            manualAt: null,
            sourceData: scanned("2026-01-01T00:00:00Z"),
          }),
        ],
        connected,
        now,
        "UTC",
      );
      expect(ranked.map((item) => [item.person.id, item.tier])).toEqual([
        ["star", 2],
        ["known", 3],
        ["kept", 3],
        ["plain", 4],
      ]);
      expect(ranked[0].score).toBeCloseTo(365 / 30);
      expect(ranked[2].score).toBeCloseTo(365 / 180);
      expect(ranked[0].reason).toBe("No contact on record.");
    });
    it("stays excluded when an enabled source is stale or never scanned them", () => {
      expect(
        rankCandidates(
          [
            silent("a", { sourceData: scanned(null, "2026-09-20T00:00:00Z") }),
            silent("b", { sourceData: {} }),
          ],
          connected,
          now,
          "UTC",
        ),
      ).toEqual([]);
      expect(
        rankCandidates(
          [silent("a", { starred: true })],
          {
            ...connected,
            imessage: {
              ...connected.imessage,
              lastSuccessAt: "2026-09-20T00:00:00Z",
            },
          },
          now,
          "UTC",
        ),
      ).toEqual([]);
    });
    it("still honours hide, snooze, archive and the suggestion cooldown", () => {
      expect(
        rankCandidates(
          [
            silent("hidden", { preference: preference({ excludedAt: now }) }),
            silent("snoozed", {
              preference: preference({ snoozedUntil: new Date("2026-10-05") }),
            }),
            silent("archived", { archived: true }),
            silent("recent", {
              preference: preference({
                lastSuggestedAt: new Date("2026-09-25"),
              }),
            }),
          ],
          connected,
          now,
          "UTC",
        ),
      ).toEqual([]);
    });
    it("builds the review queue from verifiably silent, unreviewed people in name order", () => {
      const queue = reviewQueue(
        [
          silent("3", { firstName: "Zed", lastName: null }),
          silent("2", { firstName: "Amy", lastName: "B" }),
          silent("1", { firstName: "Amy", lastName: "B" }),
          silent("snoozed", {
            firstName: "Bea",
            lastName: null,
            preference: preference({
              snoozedUntil: new Date("2026-10-05"),
              lastSuggestedAt: now,
            }),
          }),
          silent("star", { starred: true }),
          silent("kept", { preference: preference({ cadenceDays: 90 }) }),
          silent("hidden", { preference: preference({ excludedAt: now }) }),
          silent("archived", { archived: true }),
          silent("stale", {
            sourceData: scanned(null, "2026-09-20T00:00:00Z"),
          }),
          person("known", {
            manualAt: null,
            sourceData: scanned("2026-01-01T00:00:00Z"),
          }),
          person("manual"),
        ],
        connected,
        now,
      );
      expect(queue.map((item) => item.id)).toEqual(["1", "2", "snoozed", "3"]);
    });
    it("a pending reminder keeps them out of the filler tier and the review", () => {
      const waiting = silent("waiting", {
        preference: preference({ dueOn: "2026-10-06" }),
      });
      expect(rankCandidates([waiting], connected, now, "UTC")).toEqual([]);
      expect(reviewQueue([waiting], connected, now)).toEqual([]);
      const kept = silent("kept", {
        preference: preference({ dueOn: "2026-10-06", cadenceDays: 90 }),
      });
      expect(rankCandidates([kept], connected, now, "UTC")[0].tier).toBe(3);
    });
    it("category balance does not pull them ahead of people who are due", () => {
      const due = ["a", "b", "c", "d"].map((id) =>
        person(id, {
          manualAt: null,
          sourceData: scanned("2026-01-01T00:00:00Z"),
        }),
      );
      const ranked = rankCandidates(
        [silent("family", { circles: ["family"] }), ...due],
        connected,
        now,
        "UTC",
      );
      expect(selectCandidates(ranked, 4).map((c) => c.person.id)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
      // Once the due people are taken, the tier fills the remaining slot.
      expect(selectCandidates(ranked, 5).map((c) => c.tier)).toEqual([
        3, 3, 3, 3, 4,
      ]);
    });
  });
});
describe("user-set call sheet reminders", () => {
  const pref = (extra: Partial<NonNullable<PolicyPerson["preference"]>>) => ({
    cadenceDays: null,
    snoozedUntil: null,
    excludedAt: null,
    lastSuggestedAt: null,
    dueOn: null,
    dueNote: null,
    ...extra,
  });
  it("puts a due reminder first as tier 0 with its note", () => {
    const ranked = rankCandidates(
      [
        person("birthday", {
          birthday: new Date("1990-09-29"),
          manualAt: null,
        }),
        person("overdue"),
        person("asked", {
          preference: pref({ dueOn: "2026-09-28", dueNote: "the lease" }),
        }),
      ],
      sources,
      now,
      "UTC",
    );
    expect(ranked.map((item) => item.person.id)).toEqual([
      "asked",
      "birthday",
      "overdue",
    ]);
    expect(ranked[0]).toMatchObject({
      tier: 0,
      reason: "You asked to be reminded today.",
      reminder: { note: "the lease" },
    });
    expect(ranked[1].reminder).toBeUndefined();
  });
  it("bypasses snooze, the 7-day cooldown, recent contact and cadence", () => {
    const ranked = rankCandidates(
      [
        person("snoozed", {
          preference: pref({
            dueOn: "2026-09-28",
            snoozedUntil: new Date("2026-10-20T00:00:00Z"),
          }),
        }),
        person("cooldown", {
          preference: pref({ dueOn: "2026-09-28", lastSuggestedAt: now }),
        }),
        person("recent", {
          manualAt: new Date("2026-09-27T00:00:00Z"),
          preference: pref({ dueOn: "2026-09-28" }),
        }),
        person("unknown", {
          manualAt: null,
          preference: pref({ dueOn: "2026-09-28", cadenceDays: 365 }),
        }),
      ],
      sources,
      now,
      "UTC",
    );
    expect(ranked.map((item) => item.person.id).sort()).toEqual([
      "cooldown",
      "recent",
      "snoozed",
      "unknown",
    ]);
    expect(ranked.every((item) => item.tier === 0 && item.reminder)).toBe(true);
  });
  it("fires late when the due day was missed, using the sheet's timezone", () => {
    const missed = person("missed", {
      manualAt: null,
      preference: pref({ dueOn: "2026-09-20" }),
    });
    expect(rankCandidates([missed], sources, now, "UTC")[0].tier).toBe(0);
    // 02:00 UTC on the 28th is still the 27th in New York.
    const early = new Date("2026-09-28T02:00:00Z");
    const tomorrow = person("tomorrow", {
      manualAt: null,
      preference: pref({ dueOn: "2026-09-28" }),
    });
    expect(
      rankCandidates([tomorrow], sources, early, "America/New_York"),
    ).toEqual([]);
    expect(rankCandidates([tomorrow], sources, early, "UTC")[0].tier).toBe(0);
  });
  it("ignores a future date and leaves normal ranking alone", () => {
    const future = person("future", {
      manualAt: null,
      preference: pref({ dueOn: "2026-10-06" }),
    });
    expect(rankCandidates([future], sources, now, "UTC")).toEqual([]);
    const overdue = person("overdue", {
      preference: pref({ dueOn: "2026-10-06" }),
    });
    const [ranked] = rankCandidates([overdue], sources, now, "UTC");
    expect(ranked.tier).toBe(3);
    expect(ranked.reminder).toBeUndefined();
  });
  it("still respects archived and hidden people", () => {
    expect(
      rankCandidates(
        [
          person("archived", {
            archived: true,
            preference: pref({ dueOn: "2026-09-28" }),
          }),
          person("hidden", {
            preference: pref({ dueOn: "2026-09-28", excludedAt: now }),
          }),
        ],
        sources,
        now,
        "UTC",
      ),
    ).toEqual([]);
  });
  it("validates local dates and does calendar arithmetic", () => {
    expect(isLocalDate("2026-10-06")).toBe(true);
    for (const bad of [
      "2026-02-30",
      "2026-1-06",
      "2026-10-06T00:00",
      "",
      null,
      20261006,
    ])
      expect(isLocalDate(bad)).toBe(false);
    expect(addLocalDays("2026-09-28", 730)).toBe("2028-09-27");
    expect(addLocalDays("2026-03-07", 2)).toBe("2026-03-09");
  });
});
