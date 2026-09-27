import { describe, expect, it } from "vitest";
import {
  byActivity,
  byPastRelationship,
  matchesPersonName,
  defaultView,
  duration,
  groupByStage,
  lastActivity,
  monthRange,
  parseView,
  relationshipDates,
  shortDate,
  spanLabel,
  vibeTone,
  withStage,
  type BoardPerson,
} from "@/lib/dating-board";

const person = (over: Partial<BoardPerson> & { id: string }): BoardPerson => ({
  stage: "talking",
  metAt: null,
  endedAt: null,
  lastMessageAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  firstEventAt: null,
  lastEventAt: null,
  ...over,
});

const NOW = new Date("2026-09-26T12:00:00.000Z");

describe("simple card dates", () => {
  it("shows recorded dates without implying that a paused relationship continues", () => {
    expect(relationshipDates(person({ id: "a", stage: "paused", metAt: "2025-07-01" }))).toBe("Met Jul 2025");
    expect(relationshipDates(person({ id: "a", stage: "ended", metAt: "2025-07-01", endedAt: "2026-02-01" }))).toBe("Jul 2025–Feb 2026");
  });
  it("does not use imported activity or creation dates as relationship boundaries", () => {
    expect(relationshipDates(person({ id: "a", firstEventAt: "2025-07-01", lastEventAt: "2026-02-01" }))).toBeNull();
    expect(relationshipDates(person({ id: "a", stage: "ended", metAt: "2025-07-01", lastEventAt: "2026-02-01" }))).toBe("Met Jul 2025");
  });
  it("handles missing, invalid, or inconsistent boundaries without invalid date ranges", () => {
    expect(relationshipDates(person({ id: "a", stage: "ended", endedAt: "2025-03-01" }))).toBe("Ended Mar 2025");
    expect(relationshipDates(person({ id: "a", stage: "ended", metAt: "2026-01-01", endedAt: "2025-03-01" }))).toBe("Ended Mar 2025");
    expect(relationshipDates(person({ id: "a", metAt: "invalid" }))).toBeNull();
  });
});

describe("lastActivity", () => {
  it("takes the newest of text, event and creation", () => {
    const p = person({
      id: "a",
      lastMessageAt: "2026-09-01T00:00:00.000Z",
      lastEventAt: "2026-09-10T12:00:00.000Z",
    });
    expect(lastActivity(p)).toBe(Date.parse("2026-09-10T12:00:00.000Z"));
  });

  it("counts endedAt only while ended", () => {
    const base = { id: "a", endedAt: "2026-09-20T00:00:00.000Z" };
    expect(lastActivity(person({ ...base, stage: "ended" }))).toBe(Date.parse("2026-09-20T00:00:00.000Z"));
    expect(lastActivity(person({ ...base, stage: "dating" }))).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });
});

describe("groupByStage", () => {
  it("returns every stage in order, sorted by most recent activity", () => {
    const people = [
      person({ id: "old", stage: "dating", lastMessageAt: "2026-08-01T00:00:00.000Z" }),
      person({ id: "new", stage: "dating", lastEventAt: "2026-09-20T12:00:00.000Z" }),
      person({ id: "mid", stage: "dating", lastMessageAt: "2026-09-01T00:00:00.000Z" }),
      person({ id: "x", stage: "ended", endedAt: "2026-03-01T00:00:00.000Z" }),
      person({ id: "weird", stage: "situationship" }),
    ];
    const g = groupByStage(people);
    expect(Object.keys(g)).toEqual(["talking", "dating", "exclusive", "paused", "ended"]);
    expect(g.dating.map((p) => p.id)).toEqual(["new", "mid", "old"]);
    expect(g.ended.map((p) => p.id)).toEqual(["x"]);
    expect(g.talking.map((p) => p.id)).toEqual(["weird"]);
    expect(g.exclusive).toEqual([]);
  });

  it("breaks ties by id so the order is stable", () => {
    const a = person({ id: "a" });
    const b = person({ id: "b" });
    expect([b, a].sort(byActivity).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("withStage", () => {
  it("stamps endedAt when moving to ended, keeps it when leaving", () => {
    const p = person({ id: "a", stage: "dating" });
    const ended = withStage(p, "ended", NOW);
    expect(ended).toMatchObject({ stage: "ended", endedAt: NOW.toISOString() });
    expect(withStage(ended, "talking", NOW)).toMatchObject({ stage: "talking", endedAt: NOW.toISOString() });
    expect(p.stage).toBe("dating");
  });

  it("is a no-op for the same stage", () => {
    const p = person({ id: "a", stage: "ended", endedAt: "2025-01-01T00:00:00.000Z" });
    expect(withStage(p, "ended", NOW)).toBe(p);
  });
});

describe("view", () => {
  it("defaults to board at 1024px and up", () => {
    expect(defaultView(1024)).toBe("board");
    expect(defaultView(1023)).toBe("rows");
    expect(defaultView(390)).toBe("rows");
  });

  it("parses only known views", () => {
    expect(parseView("rows")).toBe("rows");
    expect(parseView("kanban")).toBeNull();
    expect(parseView(null)).toBeNull();
  });
});

describe("labels", () => {
  it.each([
    [0, "0 days"],
    [1, "1 day"],
    [13, "13 days"],
    [35, "5 wks"],
    [49, "7 wks"],
    [90, "3 mos"],
    [800, "2 yrs"],
  ])("duration %d days → %s", (days, want) => expect(duration(days * 86_400_000)).toBe(want));

  it("formats month ranges", () => {
    expect(monthRange("2026-06-03T12:00:00Z", "2026-06-28T12:00:00Z")).toBe("Jun 2026");
    expect(monthRange("2026-06-03T12:00:00Z", "2026-07-10T12:00:00Z")).toBe("Jun–Jul 2026");
    expect(monthRange("2025-12-03T12:00:00Z", "2026-02-10T12:00:00Z")).toBe("Dec 2025–Feb 2026");
  });

  it("shows the year only outside the current one", () => {
    expect(shortDate("2026-09-12T12:00:00Z", NOW)).toBe("Sep 12");
    expect(shortDate("2025-09-12T12:00:00Z", NOW)).toBe("Sep 12, 2025");
  });

  it("spans an ended relationship from start to end", () => {
    const p = person({
      id: "a",
      stage: "ended",
      metAt: "2026-06-01T12:00:00Z",
      endedAt: "2026-07-06T12:00:00Z",
    });
    expect(spanLabel(p, NOW)).toBe("Jun–Jul 2026 · 5 wks");
  });

  it("falls back to the first event, then to just the end", () => {
    expect(
      spanLabel(person({ id: "a", stage: "ended", firstEventAt: "2025-01-10T12:00:00Z", endedAt: "2025-03-14T12:00:00Z" }), NOW),
    ).toBe("Jan–Mar 2025 · 2 mos");
    expect(spanLabel(person({ id: "a", stage: "ended", endedAt: "2025-03-14T12:00:00Z" }), NOW)).toBe("Ended Mar 2025");
  });

  it("counts an ongoing one up to now", () => {
    expect(spanLabel(person({ id: "a", stage: "dating", metAt: "2026-08-08T12:00:00Z" }), NOW)).toBe("since Aug 2026 · 7 wks");
    expect(spanLabel(person({ id: "a", createdAt: "2026-09-02T00:00:00Z" }), NOW)).toBe("Added Sep 2026");
  });

  it("buckets vibe", () => {
    expect(vibeTone(8)).toBe("good");
    expect(vibeTone(5.5)).toBe("ok");
    expect(vibeTone(3)).toBe("low");
  });
});

describe("overview search and history", () => {
  it("matches all name fragments across punctuation, accents and international characters", () => {
    expect(matchesPersonName("Renée Anne-Marie", "marie renee")).toBe(true);
    expect(matchesPersonName("林 美玲", "美玲")).toBe(true);
    expect(matchesPersonName("Renée", "renee different")).toBe(false);
    expect(matchesPersonName("Renée", "   ")).toBe(true);
    expect(matchesPersonName("Renée", "---")).toBe(false);
  });
  it("uses explicit past dates and leaves undated relationships last", () => {
    const records = [
      person({id:"unknown", stage:"ended", createdAt:"2026-09-27"}),
      person({id:"older", stage:"ended", endedAt:"2025-01-01", lastEventAt:"2026-09-27"}),
      person({id:"recent", stage:"ended", endedAt:"2026-01-01"}),
      person({id:"start-only", stage:"ended", metAt:"2025-07-01", endedAt:"invalid"}),
    ];
    expect(records.sort(byPastRelationship).map((p)=>p.id)).toEqual(["recent","start-only","older","unknown"]);
  });
});
