import { describe, expect, it } from "vitest";
import {
  calendarDaysBetween,
  formatRowDate,
  groupNotesByRecency,
  isFocusShortcut,
  notePreview,
  recencyLabel,
} from "./notes-ui";

// Local-time constructors so the tests hold in any TZ.
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min);
const NOW = at(2026, 9, 26, 15, 4);

describe("calendarDaysBetween", () => {
  it("counts calendar days, not 24h spans", () => {
    expect(calendarDaysBetween(at(2026, 9, 25, 23, 59), at(2026, 9, 26, 0, 1))).toBe(1);
    expect(calendarDaysBetween(at(2026, 9, 26, 0, 1), at(2026, 9, 26, 23, 59))).toBe(0);
  });
});

describe("recencyLabel", () => {
  it("buckets like Apple Notes", () => {
    expect(recencyLabel(at(2026, 9, 26, 1), NOW)).toBe("Today");
    expect(recencyLabel(at(2026, 9, 27), NOW)).toBe("Today"); // clock skew → today
    expect(recencyLabel(at(2026, 9, 25), NOW)).toBe("Yesterday");
    expect(recencyLabel(at(2026, 9, 19), NOW)).toBe("Previous 7 Days");
    expect(recencyLabel(at(2026, 9, 18), NOW)).toBe("Previous 30 Days");
    expect(recencyLabel(at(2026, 8, 27), NOW)).toBe("Previous 30 Days");
    expect(recencyLabel(at(2026, 8, 26), NOW, "en-US")).toBe("August");
    expect(recencyLabel(at(2026, 1, 2), NOW, "en-US")).toBe("January");
    expect(recencyLabel(at(2025, 12, 31), NOW)).toBe("2025");
  });
});

describe("groupNotesByRecency", () => {
  it("keeps order and merges consecutive buckets", () => {
    const notes = [
      { id: "a", updatedAt: at(2026, 9, 26, 14) },
      { id: "b", updatedAt: at(2026, 9, 26, 9).toISOString() },
      { id: "c", updatedAt: at(2026, 9, 25) },
      { id: "d", updatedAt: at(2026, 9, 1) },
      { id: "e", updatedAt: at(2024, 3, 1) },
    ];
    const groups = groupNotesByRecency(notes, NOW);
    expect(groups.map((g) => [g.label, g.notes.map((n) => n.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      ["Previous 30 Days", ["d"]],
      ["2024", ["e"]],
    ]);
  });

  it("returns no groups for no notes", () => {
    expect(groupNotesByRecency([], NOW)).toEqual([]);
  });
});

describe("formatRowDate", () => {
  it("uses time today, Yesterday, weekday, then numeric date", () => {
    // ICU may use a narrow no-break space before AM/PM.
    expect(formatRowDate(at(2026, 9, 26, 9, 5), NOW, "en-US").replace(/\s/g, " ")).toBe("9:05 AM");
    expect(formatRowDate(at(2026, 9, 25), NOW, "en-US")).toBe("Yesterday");
    expect(formatRowDate(at(2026, 9, 22), NOW, "en-US")).toBe("Tuesday");
    expect(formatRowDate(at(2026, 9, 19), NOW, "en-US")).toBe("9/19/26");
  });
});

describe("notePreview", () => {
  it("returns the first non-empty trimmed line", () => {
    expect(notePreview("\n  \n  hello world  \nsecond")).toBe("hello world");
    expect(notePreview("")).toBe("");
    expect(notePreview("   \n\t")).toBe("");
  });
});

describe("isFocusShortcut", () => {
  const base = { key: "\\", code: "Backslash", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  it("matches Cmd+\\ and Ctrl+\\", () => {
    expect(isFocusShortcut({ ...base, metaKey: true })).toBe(true);
    expect(isFocusShortcut({ ...base, ctrlKey: true })).toBe(true);
    // Non-US layout: physical key reports a different character.
    expect(isFocusShortcut({ ...base, key: "#", metaKey: true })).toBe(true);
  });
  it("ignores other combos", () => {
    expect(isFocusShortcut(base)).toBe(false);
    expect(isFocusShortcut({ ...base, metaKey: true, shiftKey: true })).toBe(false);
    expect(isFocusShortcut({ ...base, metaKey: true, altKey: true })).toBe(false);
    expect(isFocusShortcut({ ...base, key: "k", code: "KeyK", metaKey: true })).toBe(false);
  });
});
