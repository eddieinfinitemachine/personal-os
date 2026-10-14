import { describe, expect, it } from "vitest";
import { interactionData, parseActivitiesCapture } from "./ecpad-activities";

const now = new Date("2026-10-05T12:00:00Z");
const key = (n: number) => `ecpad:${n.toString(16).padStart(64, "0")}`;
const activity = (extra: Record<string, unknown> = {}) => ({
  externalKey: key(1),
  personIds: ["p1"],
  occurredAt: "2026-10-01T00:00:00Z",
  kind: "dinner",
  title: "Dinner with Alex Rivera",
  notes: "“we should do this monthly”",
  sourceTitle: "Journal",
  sourceRef: "ecpad://note/Journal%2F2026.md",
  ...extra,
});
const parse = (body: unknown) => parseActivitiesCapture(body, now);

describe("parseActivitiesCapture", () => {
  it("accepts the documented shape", () => {
    expect(parse({ activities: [activity()], deleted: [key(2)] })).toEqual({
      activities: [
        {
          externalKey: key(1),
          personIds: ["p1"],
          occurredAt: new Date("2026-10-01T00:00:00Z"),
          kind: "dinner",
          title: "Dinner with Alex Rivera",
          notes: "“we should do this monthly”",
          sourceTitle: "Journal",
          sourceRef: "ecpad://note/Journal%2F2026.md",
        },
      ],
      deleted: [key(2)],
    });
    expect(parse({ deleted: [key(2)] }).activities).toEqual([]);
    expect(parse({ activities: [activity({ notes: null, sourceTitle: undefined, sourceRef: null })] }).activities[0]).toMatchObject({ notes: null, sourceTitle: null, sourceRef: null });
  });
  it("rejects unknown fields at both levels", () => {
    expect(() => parse({ activities: [activity()], userId: "other" })).toThrow("Unknown field");
    expect(() => parse({ activities: [activity({ source: "manual" })] })).toThrow("Unknown field");
  });
  it("caps batch sizes", () => {
    const many = Array.from({ length: 101 }, (_, i) => activity({ externalKey: key(i) }));
    expect(() => parse({ activities: many })).toThrow(expect.objectContaining({ status: 413 }));
    expect(parse({ activities: many.slice(0, 100) }).activities).toHaveLength(100);
    expect(() => parse({ deleted: Array.from({ length: 501 }, (_, i) => key(i)) })).toThrow(expect.objectContaining({ status: 413 }));
    expect(() => parse({ activities: [activity({ personIds: Array.from({ length: 21 }, (_, i) => `p${i}`) })] })).toThrow("personIds");
  });
  it("rejects bad or out-of-range dates", () => {
    for (const occurredAt of ["2026-10-01", "2026-10-01T00:00:00+02:00", "2026-02-31T00:00:00Z", "yesterday", 1_700_000_000_000, null])
      expect(() => parse({ activities: [activity({ occurredAt })] })).toThrow("occurredAt");
    expect(() => parse({ activities: [activity({ occurredAt: "2026-10-06T12:00:01Z" })] })).toThrow("out of range");
    expect(() => parse({ activities: [activity({ occurredAt: "2021-10-01T00:00:00Z" })] })).toThrow("out of range");
    expect(parse({ activities: [activity({ occurredAt: "2026-10-06T11:59:59.500Z" })] }).activities).toHaveLength(1);
    expect(parse({ activities: [activity({ occurredAt: "2021-10-06T00:00:00Z" })] }).activities).toHaveLength(1);
  });
  it("validates keys, kinds, lengths, people and duplicates", () => {
    expect(() => parse({ activities: [activity({ externalKey: "granola:abc" })] })).toThrow("externalKey");
    expect(() => parse({ deleted: ["ecpad:XYZ"] })).toThrow("externalKey");
    expect(() => parse({ activities: [activity({ kind: "date" })] })).toThrow("kind");
    expect(() => parse({ activities: [activity({ title: "x".repeat(121) })] })).toThrow("title");
    expect(() => parse({ activities: [activity({ title: "  " })] })).toThrow("title");
    expect(() => parse({ activities: [activity({ notes: "x".repeat(601) })] })).toThrow("notes");
    expect(() => parse({ activities: [activity({ personIds: [] })] })).toThrow("personIds");
    expect(() => parse({ activities: [activity({ personIds: ["p1", "p1"] })] })).toThrow("Duplicate");
    expect(() => parse({ activities: [activity({ sourceRef: "https://example.com" })] })).toThrow("sourceRef");
    expect(() => parse({ activities: [activity(), activity()] })).toThrow("only once");
    expect(() => parse({ activities: [activity()], deleted: [key(1)] })).toThrow("only once");
    expect(() => parse({})).toThrow("Nothing to save");
    expect(() => parse([])).toThrow();
    expect(() => parse({ activities: {} })).toThrow("list");
  });
});

describe("interactionData", () => {
  it("names the source note in the notes", () => {
    const [parsed] = parse({ activities: [activity()] }).activities;
    expect(interactionData(parsed)).toEqual({
      occurredAt: new Date("2026-10-01T00:00:00Z"),
      kind: "dinner",
      title: "Dinner with Alex Rivera",
      notes: "“we should do this monthly”\n\nFrom EC Pad: Journal",
      personIds: ["p1"],
    });
    const [bare] = parse({ activities: [activity({ notes: undefined, sourceTitle: undefined })] }).activities;
    expect(interactionData(bare).notes).toBeNull();
  });
});
