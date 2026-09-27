import { describe, expect, it } from "vitest";
import {
  clientToday,
  describeOrganize,
  fmtDuration,
  journalExternalId,
  journalItem,
  journalText,
  keyDates,
  lastEventDay,
  organizeCounts,
  parseProposal,
  pendingJournalIds,
  resolveJournalDay,
  type KnownPerson,
} from "@/lib/dating";

const today = "2026-09-26";
const people: KnownPerson[] = [{ id: "ana1", name: "Ana", remember: [], greenFlags: ["Kind"], redFlags: [], lessons: null }];

describe("resolveJournalDay", () => {
  it("keeps real dates years back and drops bad or far-future ones", () => {
    expect(resolveJournalDay("2025-01-31", today)).toBe("2025-01-31");
    expect(resolveJournalDay("2019-06-02", today)).toBe("2019-06-02");
    expect(resolveJournalDay("2027-03-01", today)).toBe("2027-03-01");
    expect(resolveJournalDay("2028-01-01", today)).toBeNull();
    expect(resolveJournalDay("1980-01-01", today)).toBeNull();
    expect(resolveJournalDay("2025-02-30", today)).toBeNull();
    expect(resolveJournalDay("last spring", today)).toBeNull();
    expect(resolveJournalDay(null, today)).toBeNull();
  });
});

describe("parseProposal journal mode", () => {
  const raw = {
    people: [
      {
        personId: "ana1",
        name: "Ana",
        events: [
          { kind: "date", title: "First date at Lilia", occurredAt: "2025-01-31", vibe: 8 },
          { kind: "conflict", title: "Fight about travel", occurredAt: "2025-04-02", vibe: null },
          { kind: "date", title: "Some dinner", occurredAt: null },
        ],
        greenFlags: ["kind", "Funny"],
        stage: "ended",
      },
    ],
  };

  it("keeps old explicit dates and drops undated events", () => {
    const p = parseProposal(raw, { people, noteDay: today, personId: "ana1", journal: true });
    expect(p.people[0].events.map((e) => [e.occurredAt, e.title])).toEqual([
      ["2025-01-31", "First date at Lilia"],
      ["2025-04-02", "Fight about travel"],
    ]);
    expect(p.people[0].greenFlags).toEqual(["Funny"]);
  });

  it("without journal mode, old dates snap to the note day (unchanged behavior)", () => {
    const p = parseProposal(raw, { people, noteDay: today, personId: "ana1" });
    expect(p.people[0].events.map((e) => e.occurredAt)).toEqual([today, today, today]);
  });

  it("allows more than 10 events for a journal", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      kind: "date",
      title: `Date ${i}`,
      occurredAt: `2025-03-${String(i + 1).padStart(2, "0")}`,
    }));
    const p = parseProposal({ people: [{ personId: "ana1", events: many }] }, { people, noteDay: today, personId: "ana1", journal: true });
    expect(p.people[0].events).toHaveLength(25);
  });
});

describe("journalText / pendingJournalIds", () => {
  it("joins notes and lessons, empty without notes", () => {
    expect(journalText("  Met on Hinge. ", "Go slow.")).toBe("Met on Hinge.\n\nLessons I already wrote down:\nGo slow.");
    expect(journalText("Met on Hinge.", null)).toBe("Met on Hinge.");
    expect(journalText("   ", "Go slow.")).toBe("");
    expect(journalText(null)).toBe("");
  });

  it("lists people with notes and no journal marker, minus skipped", () => {
    const ppl = [
      { id: "a", notes: "long notes" },
      { id: "b", notes: "  " },
      { id: "c", notes: null },
      { id: "d", notes: "done already" },
      { id: "e", notes: "failed earlier" },
      { id: "f", notes: "fresh" },
    ];
    expect(pendingJournalIds(ppl, [journalExternalId("d"), "granola:m1:a", null], ["e"])).toEqual(["a", "f"]);
    expect(journalExternalId("x1")).toBe("journal:x1");
  });
});

describe("journalItem", () => {
  const empty = {
    personId: "ana1",
    name: "Ana",
    isNew: false,
    summary: "",
    note: "",
    remember: [],
    greenFlags: [],
    redFlags: [],
    lessons: "",
    stage: "ended" as const,
    instagram: null,
    events: [],
  };
  it("keeps a proposed stage only over the default", () => {
    expect(journalItem({ id: "ana1", name: "Ana", stage: "talking" }, empty).stage).toBe("ended");
    expect(journalItem({ id: "ana1", name: "Ana", stage: "dating" }, empty).stage).toBeNull();
  });
  it("builds an empty item when Claude found nothing", () => {
    const item = journalItem({ id: "ana1", name: "Ana", stage: "talking" }, undefined);
    expect(item).toMatchObject({ personId: "ana1", events: [], stage: null, isNew: false });
  });
});

describe("organizeCounts / describeOrganize", () => {
  it("counts dates, other moments, flags, details and lesson paragraphs", () => {
    const c = organizeCounts({
      events: [
        { kind: "date", title: "a", occurredAt: "2025-01-01", vibe: null, notes: "" },
        { kind: "date", title: "b", occurredAt: "2025-02-01", vibe: null, notes: "" },
        { kind: "milestone", title: "c", occurredAt: "2025-03-01", vibe: null, notes: "" },
      ],
      greenFlags: ["x", "y"],
      redFlags: ["z"],
      remember: ["r"],
      lessons: "Go slow.\n\nSay what I want early.",
    });
    expect(c).toEqual({ dates: 2, moments: 1, flags: 3, remember: 1, lessons: 2 });
    expect(describeOrganize(c)).toBe("Added 2 dates, 1 moment, 3 flags, 1 detail, 2 lessons");
    expect(describeOrganize({ dates: 0, moments: 0, flags: 0, remember: 0, lessons: 0 })).toBe("Nothing new to add");
    expect(organizeCounts({ events: [], greenFlags: [], redFlags: [], remember: [], lessons: "- one\n- two" }).lessons).toBe(2);
  });

  it("finds the latest event day", () => {
    expect(lastEventDay([{ occurredAt: "2025-01-31" }, { occurredAt: "2025-04-02" }, { occurredAt: "2024-12-01" }])).toBe("2025-04-02");
    expect(lastEventDay([])).toBeNull();
  });
});

describe("keyDates / fmtDuration", () => {
  const now = new Date("2026-09-26T12:00:00Z").getTime();
  const ev = (kind: string, day: string, vibe: number | null = null) => ({
    kind,
    occurredAt: `${day}T12:00:00.000Z`,
    vibe,
    title: `${kind} ${day}`,
  });

  it("uses first and last moments for an ended thing without dates set", () => {
    const k = keyDates(
      { stage: "ended", metAt: null, endedAt: null },
      [ev("note", "2026-09-26"), ev("date", "2025-01-31", 7), ev("date", "2025-03-01", 9), ev("conflict", "2025-04-02")],
      now,
    );
    expect(k.met).toBe("2025-01-31T12:00:00.000Z");
    expect(k.from).toBe("2025-01-31T12:00:00.000Z");
    expect(k.to).toBe("2025-04-02T12:00:00.000Z");
    expect(k.ongoing).toBe(false);
    expect(k.days).toBe(61);
    expect(k.lastDate).toMatchObject({ occurredAt: "2025-03-01T12:00:00.000Z", vibe: 9 });
    expect(k.dates).toBe(2);
  });

  it("runs to now while ongoing and prefers metAt", () => {
    const k = keyDates({ stage: "dating", metAt: "2026-09-01T12:00:00.000Z", endedAt: null }, [ev("date", "2026-09-05")], now);
    expect(k.met).toBe("2026-09-01T12:00:00.000Z");
    expect(k.to).toBeNull();
    expect(k.days).toBe(25);
    expect(keyDates({ stage: "talking", metAt: null, endedAt: null }, [], now)).toMatchObject({ met: null, days: null, dates: 0, lastDate: null });
  });

  it("formats durations", () => {
    expect(fmtDuration(0)).toBe("0 days");
    expect(fmtDuration(1)).toBe("1 day");
    expect(fmtDuration(20)).toBe("3 weeks");
    expect(fmtDuration(61)).toBe("2 months");
    expect(fmtDuration(365)).toBe("1 year");
    expect(fmtDuration(430)).toBe("1 year 2 months");
    expect(fmtDuration(800)).toBe("2 years 2 months");
  });
});

describe("clientToday", () => {
  const now = new Date("2026-09-27T01:30:00Z"); // 9:30pm on the 26th in New York
  it("takes the client's local day when it's within a day of now", () => {
    expect(clientToday("2026-09-26", now)).toBe("2026-09-26");
    expect(clientToday("2026-09-27", now)).toBe("2026-09-27");
  });
  it("falls back to now for anything else", () => {
    expect(clientToday("2026-09-20", now)).toBe(now);
    expect(clientToday("2026-02-30", now)).toBe(now);
    expect(clientToday("yesterday", now)).toBe(now);
    expect(clientToday(undefined, now)).toBe(now);
  });
});
