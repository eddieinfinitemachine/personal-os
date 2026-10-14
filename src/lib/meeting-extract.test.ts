import { describe, expect, it } from "vitest";
import { buildSystem, meetingDay, normalizeItems, oneOnOneList, resolveList, teamListBlock } from "./meeting-extract";

const LISTS = [
  { id: "todo", name: "To Do" },
  { id: "dv", name: "EC/Dave" },
  { id: "ob", name: "EC/Obie" },
  { id: "ash", name: "EC/Ash" },
  { id: "work", name: "Work" },
];

describe("resolveList", () => {
  it("routes team members by name to their initials list", () => {
    expect(resolveList(null, "David", LISTS)?.name).toBe("EC/Dave");
    expect(resolveList(null, "Dave", LISTS)?.name).toBe("EC/Dave");
    expect(resolveList(null, "david vollbach", LISTS)?.name).toBe("EC/Dave");
    expect(resolveList(null, "Obi", LISTS)?.name).toBe("EC/Obie");
    expect(resolveList(null, "Obie Odom", LISTS)?.name).toBe("EC/Obie");
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
    expect(resolveList("ec/obie", "Eddie", LISTS)?.id).toBe("ob");
    expect(resolveList("EC/Obie", "Obi", LISTS)?.name).toBe("EC/Obie");
    expect(resolveList("EC/Nope", null, LISTS)).toBeNull();
  });

  it("routes initials lists by the person's name", () => {
    const lists = [...LISTS, { id: "jc", name: "EC/JC" }, { id: "hg", name: "EC/HG" }, { id: "ben", name: "EC/Ben" }];
    expect(resolveList(null, "Joe", lists)?.name).toBe("EC/JC");
    expect(resolveList(null, "Joseph Cohen", lists)?.name).toBe("EC/JC");
    expect(resolveList(null, "Hudson", lists)?.name).toBe("EC/HG");
    expect(resolveList(null, "Ben", lists)?.name).toBe("EC/Ben");
    expect(oneOnOneList("Eddie/Joe 1:1", [], lists)?.name).toBe("EC/JC");
    expect(oneOnOneList("Hudson 1:1", [], lists)?.name).toBe("EC/HG");
  });

  it("files a team member's report under that member, unless the report has a list", () => {
    expect(resolveList(null, "Analia", LISTS)?.name).toBe("EC/Dave");
    expect(resolveList(null, "amalia", LISTS)?.name).toBe("EC/Dave");
    expect(resolveList(null, "Ash", LISTS)?.name).toBe("EC/Ash");
    expect(resolveList(null, "Ash", LISTS.filter((l) => l.name !== "EC/Ash"))?.name).toBe("EC/Dave");
  });

  it("ignores a TEAM entry whose list doesn't exist", () => {
    const lists = LISTS.filter((l) => l.name !== "EC/Dave");
    expect(resolveList(null, "Dave", lists)).toBeNull();
  });
});

describe("prompt", () => {
  it("describes TEAM lists by person and other EC/* lists by alias", () => {
    const block = teamListBlock(LISTS);
    expect(block).toContain(`- "EC/Dave" — Dave (David Vollbach), sales`);
    expect(block).toContain(`- "EC/Obie" — Obie (Obie Odom), digital`);
    expect(block).toContain(`- "EC/Ash" — ash`);
    expect(block).not.toMatch(/"EC\/Dave" — dave/);
    expect(block).not.toContain("Work");
  });

  it("omits TEAM entries whose list the user doesn't have", () => {
    const block = teamListBlock(LISTS.filter((l) => l.name !== "EC/Dave"));
    expect(block).not.toContain("Dave");
    expect(block).toContain("EC/Obie");
  });

  it("says Eddie's own items get no list", () => {
    const system = buildSystem(LISTS, "2026-09-29");
    expect(system).toContain("owned by Eddie himself");
    expect(system).toContain("Today is 2026-09-29");
    expect(buildSystem([], "2026-09-29")).toContain("(none — leave listName null");
  });
});

describe("oneOnOneList", () => {
  const eddie = { name: "Eddie Cohen", email: "eddie@infinitemachine.com" };
  it("recognises a 1:1 from the title", () => {
    expect(oneOnOneList("Eddie/Dave Weekly 1:1", [], LISTS)?.name).toBe("EC/Dave");
    expect(oneOnOneList("Obie 1-1", null, LISTS)?.name).toBe("EC/Obie");
    expect(oneOnOneList("Eddie <> David", [], LISTS)?.name).toBe("EC/Dave");
  });
  it("recognises a 1:1 from exactly two attendees", () => {
    expect(oneOnOneList("Weekly sync", [eddie, { name: "Obie Odom", email: "obie@x.com" }], LISTS)?.name).toBe("EC/Obie");
    expect(oneOnOneList("Weekly sync", [eddie, { name: null, email: "dave@x.com" }], LISTS)?.name).toBe("EC/Dave");
  });
  it("stays null for group meetings and names alone", () => {
    expect(oneOnOneList("GTM Meeting 9/28", [{ name: "Obie Odom" }], LISTS)).toBeNull();
    expect(oneOnOneList("Dave's dealer intro call", [], LISTS)).toBeNull();
    expect(oneOnOneList("Eddie, Dave and Obie 1:1", [], LISTS)).toBeNull();
    expect(oneOnOneList("Weekly sync", [eddie, { name: "Obie Odom" }, { name: "Dave" }], LISTS)).toBeNull();
    expect(oneOnOneList("Weekly sync", [eddie, { name: "Simon" }], LISTS)).toBeNull();
  });
});

describe("normalizeItems", () => {
  it("defaults unowned and non-roster items to the 1:1 list, not Eddie's own", () => {
    const dave = { id: "dv", name: "EC/Dave" };
    const items = normalizeItems(
      [
        { title: "Ask Stef about the barbecue", owner: "Kenny" },
        { title: "Plan the ambassador dinner", owner: null },
        { title: "Send the deck", owner: "Eddie" },
        { title: "Fix the no-show texts", owner: "Obi" },
      ],
      LISTS,
      dave,
    );
    expect(items.map((i) => i.listName)).toEqual(["EC/Dave", "EC/Dave", null, "EC/Obie"]);
  });

  it("validates items, dates and routes each one", () => {
    const items = normalizeItems(
      [
        { title: "  Automate no-show texts ", owner: "Obi", notes: "", dueDate: "2026-10-01", listName: null },
        { title: "Deposit backlog cleanup", owner: "David", dueDate: "2026-02-30" },
        { title: "Design the $5 test drive ad", owner: null, dueDate: "next week" },
        { title: "Send the deck", owner: "Eddie", listName: "EC/Dave" },
        { title: "" },
        null,
        { owner: "Dave" },
      ],
      LISTS,
    );
    expect(items).toEqual([
      { title: "Automate no-show texts", owner: "Obi", notes: null, dueDate: "2026-10-01", listId: "ob", listName: "EC/Obie" },
      { title: "Deposit backlog cleanup", owner: "David", notes: null, dueDate: null, listId: "dv", listName: "EC/Dave" },
      { title: "Design the $5 test drive ad", owner: null, notes: null, dueDate: null, listId: null, listName: null },
      { title: "Send the deck", owner: "Eddie", notes: null, dueDate: null, listId: "dv", listName: "EC/Dave" },
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
