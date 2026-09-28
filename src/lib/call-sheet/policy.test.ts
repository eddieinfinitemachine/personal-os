import { describe, expect, it } from "vitest";
import {
  cadence,
  identityKey,
  latestContact,
  liveCues,
  limitPersonCues,
  localDate,
  rankCandidates,
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
});
