import { describe, expect, it } from "vitest";
import {
  appendLessons,
  dateContext,
  dayKey,
  freshItems,
  granolaExternalId,
  noonUTC,
  normName,
  parseProposal,
  resolveEventDay,
  sameName,
  splitSourceLine,
  suggestionsFrom,
  withSourceLine,
  type KnownPerson,
} from "@/lib/dating";

const people: KnownPerson[] = [
  { id: "ana1", name: "Ana", remember: ["Sister is Maya"], greenFlags: ["Plans the next date"], redFlags: [], lessons: "Go slow." },
  { id: "kat1", name: "Katherine", remember: [], greenFlags: [], redFlags: [] },
];
const noteDay = "2026-09-26";

describe("parseProposal", () => {
  it("keeps known ids, drops invented fields and bad values", () => {
    const p = parseProposal(
      {
        people: [
          {
            personId: "ana1",
            name: "Anna",
            isNew: false,
            summary: "Dinner at Lilia",
            note: "We had pasta.",
            remember: ["Sister is Maya", "Loves natural wine", 7],
            greenFlags: ["plans the next date."],
            redFlags: [],
            lessons: "",
            stage: "dating",
            events: [
              { kind: "date", title: "Lilia", occurredAt: "2026-09-25", vibe: 8, notes: "" },
              { kind: "party", title: "nope", occurredAt: "2026-09-25" },
              { kind: "call", title: "Late call", occurredAt: "not a date", vibe: 42 },
            ],
            hacked: true,
          },
        ],
      },
      { people, noteDay },
    );
    expect(p.people).toHaveLength(1);
    const a = p.people[0];
    expect(a).toMatchObject({ personId: "ana1", name: "Ana", isNew: false, stage: "dating" });
    expect(a.remember).toEqual(["Loves natural wine"]);
    expect(a.greenFlags).toEqual([]);
    expect(a.events).toEqual([
      { kind: "date", title: "Lilia", occurredAt: "2026-09-25", vibe: 8, notes: "" },
      { kind: "call", title: "Late call", occurredAt: noteDay, vibe: null, notes: "" },
    ]);
    expect("hacked" in a).toBe(false);
  });

  it("turns unknown ids into new people, snapping exact names to existing ones", () => {
    const p = parseProposal(
      {
        people: [
          { personId: "someone-elses-id", name: "Jess", note: "Met at a party." },
          { personId: null, name: "katherine", note: "Called her." },
          { personId: null, name: "", note: "no name" },
        ],
      },
      { people, noteDay },
    );
    expect(p.people.map((x) => [x.personId, x.name, x.isNew])).toEqual([
      [null, "Jess", true],
      ["kat1", "Katherine", false],
    ]);
  });

  it("strict mode drops unknown ids and unmarked new people", () => {
    const p = parseProposal(
      {
        people: [
          { personId: "someone-elses-id", name: "Zoe", isNew: false, note: "forged" },
          { personId: null, name: "Jess", isNew: false, note: "not marked new" },
          { personId: null, name: "Lena", isNew: true, note: "kept" },
          { personId: "ana1", name: "Ana", note: "kept" },
        ],
      },
      { people, noteDay, strict: true },
    );
    expect(p.people.map((x) => x.name)).toEqual(["Lena", "Ana"]);
  });

  it("forces everything onto personId and merges duplicates", () => {
    const p = parseProposal(
      {
        people: [
          { personId: "kat1", name: "Kat", note: "One.", remember: ["Runs marathons"] },
          { personId: null, name: "Jess", note: "Two.", remember: ["runs marathons", "Has a dog"] },
        ],
      },
      { people, noteDay, personId: "ana1" },
    );
    expect(p.people).toHaveLength(1);
    expect(p.people[0]).toMatchObject({ personId: "ana1", note: "One.\n\nTwo.", remember: ["Runs marathons", "Has a dog"] });
  });

  it("drops lessons already written and empty entries; survives junk", () => {
    const p = parseProposal(
      { people: [{ personId: "ana1", name: "Ana", lessons: "go slow." }, { personId: "kat1", name: "Katherine" }] },
      { people, noteDay },
    );
    expect(p.people).toEqual([]);
    expect(parseProposal(null, { people, noteDay })).toEqual({ people: [] });
    expect(parseProposal({ people: "x" }, { people, noteDay })).toEqual({ people: [] });
  });
});

describe("list and lesson dedupe", () => {
  it("freshItems ignores case, spacing and trailing periods", () => {
    expect(freshItems(["Hates cilantro"], ["hates  cilantro.", "Loves jazz", "loves jazz", " "])).toEqual(["Loves jazz"]);
  });
  it("appendLessons adds a paragraph once", () => {
    expect(appendLessons(null, "Ask more questions")).toBe("Ask more questions");
    expect(appendLessons("Go slow.", "Ask more questions")).toBe("Go slow.\n\nAsk more questions");
    expect(appendLessons("Go slow.\n\nAsk more questions", "ask more questions")).toBe("Go slow.\n\nAsk more questions");
    expect(appendLessons("", "")).toBeNull();
  });
});

describe("dates", () => {
  it("dayKey / noonUTC round-trip", () => {
    expect(dayKey("2026-09-26")).toBe("2026-09-26");
    expect(dayKey(new Date("2026-09-26T23:30:00Z"))).toBe("2026-09-26");
    expect(noonUTC("2026-09-26").toISOString()).toBe("2026-09-26T12:00:00.000Z");
  });
  it("dateContext spells out the last week with weekdays", () => {
    const c = dateContext("2026-09-26");
    expect(c).toContain("Saturday 2026-09-26");
    expect(c).toContain("Friday 2026-09-25 (yesterday / last night)");
    expect(c).toContain("Saturday 2026-09-19");
  });
  it("resolveEventDay keeps real nearby dates and falls back otherwise", () => {
    expect(resolveEventDay("2026-09-20", noteDay)).toBe("2026-09-20");
    expect(resolveEventDay("2026-10-03", noteDay)).toBe("2026-10-03");
    expect(resolveEventDay("2026-02-30", noteDay)).toBe(noteDay);
    expect(resolveEventDay("2019-01-01", noteDay)).toBe(noteDay);
    expect(resolveEventDay("last night", noteDay)).toBe(noteDay);
    expect(resolveEventDay(undefined, noteDay)).toBe(noteDay);
  });
});

describe("granola keys and source lines", () => {
  it("builds a stable idempotency key", () => {
    expect(granolaExternalId(" 8f2c-1 ", "ana1")).toBe("granola:8f2c-1:ana1");
    expect(granolaExternalId("m", "")).toBe("granola:m:");
  });
  it("round-trips a source line", () => {
    const n = withSourceLine("We talked about Lisbon.", "Coffee w/ Ana", "https://notes.granola.ai/d/abc");
    expect(n).toBe("We talked about Lisbon.\n\nSource: Coffee w/ Ana https://notes.granola.ai/d/abc");
    expect(splitSourceLine(n)).toEqual({ body: "We talked about Lisbon.", label: "Coffee w/ Ana", url: "https://notes.granola.ai/d/abc" });
    expect(withSourceLine("x", null, "javascript:alert(1)")).toBe("x");
    expect(splitSourceLine("Plain note")).toEqual({ body: "Plain note", label: null, url: null });
    expect(splitSourceLine(withSourceLine("x", "Label only"))).toEqual({ body: "x", label: "Label only", url: null });
  });
});

describe("granola suggestions", () => {
  const base = { isNew: true, summary: "", note: "", remember: [], greenFlags: [], redFlags: [], lessons: "", stage: null, events: [] };
  it("compares names case- and space-insensitively", () => {
    expect(normName("  Priya   Shah ")).toBe("priya shah");
    expect(sameName("PRIYA", "priya ")).toBe(true);
    expect(sameName("Priya", "Pria")).toBe(false);
  });
  it("keeps only unmatched people, one per name", () => {
    expect(
      suggestionsFrom([
        { ...base, personId: "ana1", name: "Ana", isNew: false, note: "matched" },
        { ...base, personId: null, name: " Priya ", summary: "Hinge match", note: "" },
        { ...base, personId: null, name: "priya", note: "dupe" },
        { ...base, personId: null, name: "", note: "nameless" },
      ]),
    ).toEqual([{ name: "Priya", summary: "Hinge match", note: "Hinge match" }]);
  });
});
