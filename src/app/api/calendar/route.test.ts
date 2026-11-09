import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { todo: { findMany: mocks.findMany } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
import { GET } from "./route";

const call = (query = "") => GET(new Request(`https://example.invalid/api/calendar${query}`));
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);

const row = (id: string, day: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Todo ${id}`,
  dueDate: utc(day),
  projectId: null,
  parentId: null,
  list: { id: "l1", name: "To Do", color: "blue", userId: "u1", members: [] },
  project: null,
  ...over,
});

const MONTH_ROWS = [
  row("t1", "2026-11-12", { projectId: "p1", project: { name: "Money" } }),
  row("t2", "2026-11-12", {
    list: { id: "l9", name: "House", color: "rose", userId: "owner", members: [{ userId: "u1", color: "cyan" }] },
  }),
  row("t3", "2026-11-20", { parentId: "t1" }),
];
const UPCOMING_ROWS = [row("t0", "2026-11-08"), row("t1", "2026-11-12")];

beforeEach(() => {
  vi.clearAllMocks();
  // Local noon on Nov 8, so the server's month is November in any time zone.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 8, 12));
  mocks.user.mockResolvedValue("u1");
  // The Upcoming read is the one with a `take`.
  mocks.findMany.mockImplementation(async (args: { take?: number }) => (args.take ? UPCOMING_ROWS : MONTH_ROWS));
});
afterEach(() => vi.useRealTimers());

describe("GET /api/calendar", () => {
  it("401s when signed out, without reading todos", async () => {
    mocks.user.mockResolvedValue(null);
    const res = await call("?from=2026-11-01&to=2026-11-30");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ["?from=2026-11-01", "from and to must both be YYYY-MM-DD"],
    ["?to=2026-11-30", "from and to must both be YYYY-MM-DD"],
    ["?from=2026-02-30&to=2026-03-05", "from and to must both be YYYY-MM-DD"],
    ["?from=2026-11-01T00:00:00Z&to=2026-11-30", "from and to must both be YYYY-MM-DD"],
    ["?from=nov&to=dec", "from and to must both be YYYY-MM-DD"],
    ["?from=2026-12-01&to=2026-11-01", "from must be on or before to"],
    ["?from=2026-11-01&to=2027-02-02", "the range can't be longer than 93 days"],
    ["?from=2026-01-01&to=2026-12-31", "the range can't be longer than 93 days"],
    ["?today=2026-11-8", "today must be YYYY-MM-DD"],
  ])("400s on %s", async (query, error) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("serves a 93-day range", async () => {
    const res = await call("?from=2026-11-01&to=2027-02-01");
    expect(res.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where.dueDate).toEqual({ gte: utc("2026-11-01"), lt: utc("2027-02-02") });
  });

  it("defaults to the page's month and leaves Upcoming out without the client's today", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({ from: "2026-11-01", to: "2026-11-30", today: null, upcoming: null });
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    const { where } = mocks.findMany.mock.calls[0][0];
    expect(where).toEqual({
      dueDate: { gte: utc("2026-11-01"), lt: utc("2026-12-01") },
      completedAt: null,
      list: { OR: [{ userId: "u1" }, { members: { some: { userId: "u1" } } }] },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date(2026, 10, 8, 12) } }],
    });
  });

  it("groups the range's items by calendar day, with list, project and parent", async () => {
    const body = await (await call("?from=2026-11-01&to=2026-11-30")).json();
    expect(body.days).toEqual([
      {
        date: "2026-11-12",
        items: [
          { id: "t1", title: "Todo t1", dueDate: "2026-11-12", completedAt: null, listId: "l1", listName: "To Do", listColor: "blue", projectId: "p1", projectName: "Money", parentId: null },
          { id: "t2", title: "Todo t2", dueDate: "2026-11-12", completedAt: null, listId: "l9", listName: "House", listColor: "cyan", projectId: null, projectName: null, parentId: null },
        ],
      },
      {
        date: "2026-11-20",
        items: [
          { id: "t3", title: "Todo t3", dueDate: "2026-11-20", completedAt: null, listId: "l1", listName: "To Do", listColor: "blue", projectId: null, projectName: null, parentId: "t1" },
        ],
      },
    ]);
  });

  it("computes Upcoming from the client's today: that day and the 13 after it, at most 30", async () => {
    const body = await (await call("?from=2026-11-01&to=2026-11-30&today=2026-11-07")).json();
    expect(body.today).toBe("2026-11-07");
    expect(body.upcoming.map((i: { id: string; dueDate: string }) => [i.id, i.dueDate])).toEqual([
      ["t0", "2026-11-08"],
      ["t1", "2026-11-12"],
    ]);
    const upcomingArgs = mocks.findMany.mock.calls.map((c) => c[0]).find((a) => a.take);
    expect(upcomingArgs.take).toBe(30);
    expect(upcomingArgs.where.dueDate).toEqual({ gte: utc("2026-11-07"), lt: utc("2026-11-21") });
  });
});
