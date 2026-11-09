import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { todo: { findMany: mocks.findMany } } }));
import {
  addDays,
  calendarMonth,
  getCalendarItems,
  getUpcomingItems,
  groupByDay,
  monthRange,
  parseCalendarQuery,
  rangeDays,
  serverToday,
  type CalendarItem,
} from "./calendar";

// Local noon, so the server-clock helpers read Nov 8 in any time zone.
const NOW = new Date(2026, 10, 8, 12);

const row = (id: string, day: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Todo ${id}`,
  dueDate: new Date(`${day}T00:00:00.000Z`),
  projectId: null,
  parentId: null,
  list: { id: "l1", name: "To Do", color: "blue", userId: "u1", members: [] },
  project: null,
  ...over,
});

const item = (id: string, day: string): CalendarItem => ({
  id,
  title: id,
  dueDate: day,
  completedAt: null,
  listId: "l1",
  listName: "To Do",
  listColor: "blue",
  projectId: null,
  projectName: null,
  parentId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
});

describe("calendar days", () => {
  it("adds days across month, year and leap-day ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-11-08", 14)).toBe("2026-11-22");
  });

  it("counts a range with both ends, ignoring daylight saving", () => {
    expect(rangeDays("2026-11-01", "2026-11-01")).toBe(1);
    expect(rangeDays("2026-03-01", "2026-03-31")).toBe(31);
    expect(rangeDays("2026-11-01", "2027-02-01")).toBe(93);
  });

  it("gives a month's first and last day", () => {
    expect(monthRange(2026, 10)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange(2026, 11)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthRange(2028, 1)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("reads ?month=YYYY-MM and falls back to the server's month on anything else", () => {
    expect(calendarMonth("2026-02", NOW)).toEqual({ year: 2026, month: 1 });
    expect(calendarMonth("2027-12", NOW)).toEqual({ year: 2027, month: 11 });
    expect(calendarMonth(undefined, NOW)).toEqual({ year: 2026, month: 10 });
    // 13 used to wrap into next January with an "undefined" header.
    expect(calendarMonth("2026-13", NOW)).toEqual({ year: 2026, month: 10 });
    expect(calendarMonth("2026-00", NOW)).toEqual({ year: 2026, month: 10 });
    expect(calendarMonth("26-1", NOW)).toEqual({ year: 2026, month: 10 });
  });

  it("reads today on the server's clock", () => {
    expect(serverToday(NOW)).toBe("2026-11-08");
    expect(serverToday(new Date(2027, 0, 3, 9))).toBe("2027-01-03");
  });
});

describe("parseCalendarQuery", () => {
  const q = (s: string) => parseCalendarQuery(new URLSearchParams(s), NOW);

  it("defaults to the page's month and echoes today", () => {
    expect(q("")).toEqual({ from: "2026-11-01", to: "2026-11-30", today: null });
    expect(q("today=2026-11-07")).toEqual({ from: "2026-11-01", to: "2026-11-30", today: "2026-11-07" });
  });

  it("takes an inclusive range of up to 93 days", () => {
    expect(q("from=2026-11-05&to=2026-11-05")).toEqual({ from: "2026-11-05", to: "2026-11-05", today: null });
    expect(q("from=2026-11-01&to=2027-02-01")).toEqual({ from: "2026-11-01", to: "2027-02-01", today: null });
    expect(q("from=2026-11-01&to=2027-02-02")).toEqual({ error: "the range can't be longer than 93 days" });
  });

  it("rejects half a range, unreal or non-day dates, and a backwards range", () => {
    const both = { error: "from and to must both be YYYY-MM-DD" };
    expect(q("from=2026-11-01")).toEqual(both);
    expect(q("to=2026-11-30")).toEqual(both);
    expect(q("from=2026-02-30&to=2026-03-02")).toEqual(both);
    expect(q("from=2026-11-1&to=2026-11-30")).toEqual(both);
    expect(q("from=2026-11-01T00:00:00Z&to=2026-11-30")).toEqual(both);
    expect(q("from=&to=")).toEqual(both);
    expect(q("from=2026-12-01&to=2026-11-01")).toEqual({ error: "from must be on or before to" });
  });

  it("rejects a today that isn't a calendar day", () => {
    expect(q("today=2026-11-08T05:00:00Z")).toEqual({ error: "today must be YYYY-MM-DD" });
    expect(q("today=11/08/2026")).toEqual({ error: "today must be YYYY-MM-DD" });
  });
});

describe("getCalendarItems", () => {
  it("reads open, dated, unsnoozed todos on lists the caller can access, through the last day", async () => {
    await getCalendarItems("u1", "2026-11-01", "2026-11-30", NOW);
    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      dueDate: { gte: new Date("2026-11-01T00:00:00.000Z"), lt: new Date("2026-12-01T00:00:00.000Z") },
      completedAt: null,
      list: { OR: [{ userId: "u1" }, { members: { some: { userId: "u1" } } }] },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: NOW } }],
    });
    // No creator filter and no parentId filter: shared-list todos and dated subtasks count.
    expect(args.where).not.toHaveProperty("userId");
    expect(args.where).not.toHaveProperty("parentId");
    expect(args.orderBy).toEqual([{ dueDate: "asc" }, { position: "asc" }]);
    expect(args.select.list.select.members).toEqual({ where: { userId: "u1" }, select: { userId: true, color: true } });
    expect(args).not.toHaveProperty("take");
  });

  it("maps rows to calendar days with the list color the caller sees", async () => {
    mocks.findMany.mockResolvedValue([
      row("own", "2026-11-12", { projectId: "p1", project: { name: "Money" } }),
      row("shared", "2026-11-12", {
        list: { id: "l9", name: "House", color: "rose", userId: "owner", members: [{ userId: "u1", color: "cyan" }] },
      }),
      row("shared-plain", "2026-11-13", {
        list: { id: "l9", name: "House", color: "rose", userId: "owner", members: [{ userId: "u1", color: null }] },
        parentId: "t-parent",
      }),
    ]);
    const items = await getCalendarItems("u1", "2026-11-01", "2026-11-30", NOW);
    expect(items).toEqual([
      { id: "own", title: "Todo own", dueDate: "2026-11-12", completedAt: null, listId: "l1", listName: "To Do", listColor: "blue", projectId: "p1", projectName: "Money", parentId: null },
      { id: "shared", title: "Todo shared", dueDate: "2026-11-12", completedAt: null, listId: "l9", listName: "House", listColor: "cyan", projectId: null, projectName: null, parentId: null },
      { id: "shared-plain", title: "Todo shared-plain", dueDate: "2026-11-13", completedAt: null, listId: "l9", listName: "House", listColor: "rose", projectId: null, projectName: null, parentId: "t-parent" },
    ]);
  });
});

describe("getUpcomingItems", () => {
  it("covers today and the next 13 days, at most 30 items", async () => {
    await getUpcomingItems("u1", "2026-11-08", NOW);
    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where.dueDate).toEqual({ gte: new Date("2026-11-08T00:00:00.000Z"), lt: new Date("2026-11-22T00:00:00.000Z") });
    expect(args.where.list).toEqual({ OR: [{ userId: "u1" }, { members: { some: { userId: "u1" } } }] });
    expect(args.take).toBe(30);
  });
});

describe("groupByDay", () => {
  it("lists only days with items, ascending, keeping the order within a day", () => {
    expect(groupByDay([item("b1", "2026-11-12"), item("b2", "2026-11-12"), item("a", "2026-11-03"), item("c", "2026-11-20")])).toEqual([
      { date: "2026-11-03", items: [item("a", "2026-11-03")] },
      { date: "2026-11-12", items: [item("b1", "2026-11-12"), item("b2", "2026-11-12")] },
      { date: "2026-11-20", items: [item("c", "2026-11-20")] },
    ]);
    expect(groupByDay([])).toEqual([]);
  });
});
