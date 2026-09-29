import { describe, expect, it } from "vitest";
import { buildSystem, meetingDay, normalizeItems, resolveList, teamListBlock } from "./meeting-extract";

const LISTS = [
  { id: "todo", name: "To Do" },
  { id: "dv", name: "EC/DV" },
  { id: "ob", name: "EC/OB" },
  { id: "ash", name: "EC/Ash" },
  { id: "work", name: "Work" },
];

describe("resolveList", () => {
  it("routes team members by name to their initials list", () => {
    expect(resolveList(null, "David", LISTS)?.name).toBe("EC/DV");
    expect(resolveList(null, "Dave", LISTS)?.name).toBe("EC/DV");
    expect(resolveList(null, "david vollbach", LISTS)?.name).toBe("EC/DV");
    expect(resolveList(null, "Obi", LISTS)?.name).toBe("EC/OB");
    expect(resolveList(null, "Obie Odom", LISTS)?.name).toBe("EC/OB");
  });

  it("falls back to the EC/* alias table for other people", () => {
    expect(resolveList(null, "Ash", LISTS)?.name).toBe("EC/Ash");
    expect(resolveList(null, "Ash Schwartz", LISTS)?.name).toBe("EC/Ash");
    expect(resolveList(null, "Ashley", LISTS)?.name).toBe("EC/Ash");
  });

  it("leaves Eddie and unknown owners on To Do", () => {
    expect(resolveList(null, "Eddie", LISTS)).toBeNull();
    expect(resolveList(null, null, LISTS)).toBeNull();
    expect(resolveList(null, "Simon", LISTS)).toBeNull();
  });

  it("trusts the model's listName only when it names a real list", () => {
    expect(resolveList("ec/ob", "Eddie", LISTS)?.id).toBe("ob");
    expect(resolveList("EC/Obie", "Obi", LISTS)?.name).toBe("EC/OB");
    expect(resolveList("EC/Nope", null, LISTS)).toBeNull();
  });

  it("ignores a TEAM entry whose list doesn't exist", () => {
    const lists = LISTS.filter((l) => l.name !== "EC/DV");
    expect(resolveList(null, "Dave", lists)).toBeNull();
  });
});

describe("prompt", () => {
  it("describes TEAM lists by person and other EC/* lists by alias", () => {
    const block = teamListBlock(LISTS);
    expect(block).toContain(`- "EC/DV" — Dave (David Vollbach), sales`);
    expect(block).toContain(`- "EC/OB" — Obie (Obie Odom), digital`);
    expect(block).toContain(`- "EC/Ash" — ash`);
    expect(block).not.toMatch(/"EC\/DV" — dv/);
    expect(block).not.toContain("Work");
  });

  it("omits TEAM entries whose list the user doesn't have", () => {
    const block = teamListBlock(LISTS.filter((l) => l.name !== "EC/DV"));
    expect(block).not.toContain("Dave");
    expect(block).toContain("EC/OB");
  });

  it("says Eddie's own items get no list", () => {
    const system = buildSystem(LISTS, "2026-09-29");
    expect(system).toContain("owned by Eddie himself");
    expect(system).toContain("Today is 2026-09-29");
    expect(buildSystem([], "2026-09-29")).toContain("(none — leave listName null");
  });
});

describe("normalizeItems", () => {
  it("validates items, dates and routes each one", () => {
    const items = normalizeItems(
      [
        { title: "  Automate no-show texts ", owner: "Obi", notes: "", dueDate: "2026-10-01", listName: null },
        { title: "Deposit backlog cleanup", owner: "David", dueDate: "2026-02-30" },
        { title: "Design the $5 test drive ad", owner: null, dueDate: "next week" },
        { title: "Send the deck", owner: "Eddie", listName: "EC/DV" },
        { title: "" },
        null,
        { owner: "Dave" },
      ],
      LISTS,
    );
    expect(items).toEqual([
      { title: "Automate no-show texts", owner: "Obi", notes: null, dueDate: "2026-10-01", listId: "ob", listName: "EC/OB" },
      { title: "Deposit backlog cleanup", owner: "David", notes: null, dueDate: null, listId: "dv", listName: "EC/DV" },
      { title: "Design the $5 test drive ad", owner: null, notes: null, dueDate: null, listId: null, listName: null },
      { title: "Send the deck", owner: "Eddie", notes: null, dueDate: null, listId: "dv", listName: "EC/DV" },
    ]);
    expect(normalizeItems("nope", LISTS)).toEqual([]);
  });
});

describe("meetingDay", () => {
  it("uses Eddie's local date", () => {
    expect(meetingDay("2026-09-29T01:30:00Z")).toBe("2026-09-28");
    expect(meetingDay("2026-09-28T14:00:00Z")).toBe("2026-09-28");
    expect(meetingDay(null)).toBeNull();
    expect(meetingDay("garbage")).toBeNull();
  });
});
