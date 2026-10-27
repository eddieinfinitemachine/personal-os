import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  projectFindMany: vi.fn(),
  todoGroupBy: vi.fn(),
  todoFindMany: vi.fn(),
  noteGroupBy: vi.fn(),
  noteFindMany: vi.fn(),
  meetingGroupBy: vi.fn(),
  meetingFindMany: vi.fn(),
  sourceFindMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findMany: mocks.projectFindMany },
    todo: { groupBy: mocks.todoGroupBy, findMany: mocks.todoFindMany },
    note: { groupBy: mocks.noteGroupBy, findMany: mocks.noteFindMany },
    projectMeeting: { groupBy: mocks.meetingGroupBy, findMany: mocks.meetingFindMany },
    projectSource: { findMany: mocks.sourceFindMany },
  },
}));
import { bucketCards, getProjectsBoard, readPlan, type BoardCard } from "./board";

const NOW = new Date("2026-10-27T18:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86400_000);

const card = (name: string, daysAgo: number | null, over: Partial<BoardCard> = {}): BoardCard => ({
  id: `project:${name}`,
  kind: "project",
  name,
  company: "Personal",
  visibility: "auto",
  lastActivityAt: daysAgo === null ? null : ago(daysAgo).toISOString(),
  activity: [],
  plan: [],
  planTotal: 0,
  href: null,
  githubUrl: null,
  homepageUrl: null,
  projectId: name,
  sourceId: null,
  ...over,
});

describe("bucketCards", () => {
  it("splits active / dormant / hidden, drops old cards, and always shows pinned ones", () => {
    const { groups, dormant, hidden } = bucketCards(
      [
        card("fresh", 1),
        card("edge", 13.9),
        card("dormant", 20),
        card("ancient", 120),
        card("never", null),
        card("pinned-old", 300, { visibility: "pinned" }),
        card("hidden-new", 0, { visibility: "hidden" }),
        card("hidden-old", 400, { visibility: "hidden" }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].cards.map((c) => c.name)).toEqual(["pinned-old", "fresh", "edge"]);
    expect(dormant.map((c) => c.name)).toEqual(["dormant"]);
    expect(hidden.map((c) => c.name)).toEqual(["hidden-new", "hidden-old"]);
  });

  it("groups by company in COMPANY_ORDER, pinned first then most recent", () => {
    const { groups } = bucketCards(
      [
        card("p1", 1),
        card("w1", 2, { company: "Walden" }),
        card("im-old", 9, { company: "Infinite Machine" }),
        card("im-new", 1, { company: "Infinite Machine" }),
        card("im-pinned", 12, { company: "Infinite Machine", visibility: "pinned" }),
        card("o1", 3, { company: "Olto" }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.company)).toEqual(["Infinite Machine", "Olto", "Walden", "Personal"]);
    expect(groups[0].cards.map((c) => c.name)).toEqual(["im-pinned", "im-new", "im-old"]);
  });
});

describe("readPlan", () => {
  it("accepts the stored shape and the column default", () => {
    expect(readPlan([])).toEqual({ items: [], total: 0 });
    expect(readPlan({ items: [{ text: "a", section: null }], total: 9 })).toEqual({ items: [{ text: "a", section: null }], total: 9 });
    expect(readPlan(null)).toEqual({ items: [], total: 0 });
  });
});

describe("getProjectsBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindMany.mockResolvedValue([
      { id: "inbox", name: "Inbox", visibility: "auto", updatedAt: ago(0) },
      { id: "journal", name: "Journal", visibility: "auto", updatedAt: ago(0) },
      { id: "car", name: "Car", visibility: "auto", updatedAt: ago(60) },
      { id: "c2", name: "C2 launch", visibility: "auto", updatedAt: ago(50) },
      { id: "dog", name: "Dog", visibility: "hidden", updatedAt: ago(1) },
    ]);
    mocks.todoGroupBy.mockResolvedValue([{ projectId: "car", _max: { updatedAt: ago(30), completedAt: ago(3) } }]);
    mocks.noteGroupBy.mockResolvedValue([]);
    mocks.meetingGroupBy.mockResolvedValue([{ projectId: "c2", _max: { occurredAt: ago(2) } }]);
    mocks.todoFindMany.mockImplementation(async ({ where }: { where: { completedAt: unknown } }) =>
      where.completedAt === null
        ? Array.from({ length: 7 }, (_, i) => ({ projectId: "car", title: `Open ${i}` }))
        : [{ projectId: "car", title: "Oil change", completedAt: ago(3) }],
    );
    mocks.noteFindMany.mockResolvedValue([{ projectId: "car", title: null, body: "## Tires\nrotate", updatedAt: ago(4) }]);
    mocks.meetingFindMany.mockImplementation(async ({ where }: { where: { sourceId?: unknown } }) =>
      where.sourceId
        ? [{ sourceId: "s1", title: "Rushmore review", occurredAt: ago(0.5), url: null }]
        : [{ projectId: "c2", title: "C2 sync", occurredAt: ago(2), url: "https://notes.granola.ai/d/x" }],
    );
    mocks.sourceFindMany.mockImplementation(async ({ where }: { where: { kind: string } }) =>
      where.kind === "repo"
        ? [
            {
              id: "s1",
              key: "edcohen/rushmore",
              name: "rushmore",
              company: "Personal",
              state: "pinned",
              url: "https://github.com/edcohen/rushmore",
              homepageUrl: null,
              lastActivityAt: ago(1),
              syncedAt: ago(0.01),
              commits: [{ oid: "a", message: "Fix booking", at: ago(1).toISOString(), branch: "feat/x", url: "u" }],
              plan: { items: [{ text: "Ship", section: "Now" }], total: 12 },
            },
          ]
        : [
            {
              id: "t1",
              name: "Series A",
              company: "Infinite Machine",
              lastActivityAt: ago(1),
              meetings: [{ occurredAt: ago(1) }, { occurredAt: ago(6) }],
            },
          ],
    );
  });

  it("builds life-project cards without Inbox and Journal, from aggregates", async () => {
    const board = await getProjectsBoard("u1", false, NOW);
    const all = [...board.groups.flatMap((g) => g.cards), ...board.dormant, ...board.hidden];
    expect(all.map((c) => c.name).sort()).toEqual(["C2 launch", "Car", "Dog"]);
    const car = all.find((c) => c.name === "Car")!;
    expect(car.lastActivityAt).toBe(ago(3).toISOString());
    expect(car.plan).toHaveLength(5);
    expect(car.planTotal).toBe(7);
    expect(car.activity.map((a) => `${a.kind}:${a.text}`)).toEqual(["todo:Oil change", "note:Tires"]);
    expect(car.href).toBe("/projects/car");
    const c2 = all.find((c) => c.name === "C2 launch")!;
    expect(c2.company).toBe("Infinite Machine");
    expect(c2.activity[0]).toMatchObject({ kind: "meeting", text: "C2 sync" });
    expect(board.hidden.map((c) => c.name)).toEqual(["Dog"]);
    // Plan filters match the project page's Tasks tab.
    const openWhere = mocks.todoFindMany.mock.calls.find((c) => c[0].where.completedAt === null)![0].where;
    expect(openWhere).toMatchObject({ parentId: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: NOW } }] });
    expect(openWhere.list).toEqual({ OR: [{ userId: "u1" }, { members: { some: { userId: "u1" } } }] });
  });

  it("keeps GitHub and meeting sources founder-only", async () => {
    const board = await getProjectsBoard("u1", false, NOW);
    expect(mocks.sourceFindMany).not.toHaveBeenCalled();
    expect(board.suggested).toEqual([]);
    expect(board.syncedAt).toBeNull();
  });

  it("adds repos (commits, linked meetings, plan) and suggested topics for the founder", async () => {
    const board = await getProjectsBoard("u1", true, NOW);
    const repo = board.groups.flatMap((g) => g.cards).find((c) => c.kind === "repo")!;
    expect(repo).toMatchObject({ name: "rushmore", visibility: "pinned", planTotal: 12, sourceId: "s1" });
    expect(repo.activity.map((a) => `${a.kind}:${a.text}:${a.branch ?? ""}`)).toEqual([
      "meeting:Rushmore review:",
      "commit:Fix booking:feat/x",
    ]);
    expect(repo.lastActivityAt).toBe(ago(0.5).toISOString());
    expect(board.suggested).toEqual([
      { id: "t1", name: "Series A", company: "Infinite Machine", meetings: 2, lastMeetingAt: ago(1).toISOString() },
    ]);
    expect(board.syncedAt).toBe(ago(0.01).toISOString());
    // Pinned comes first within Personal.
    expect(board.groups.find((g) => g.company === "Personal")!.cards[0].name).toBe("rushmore");
  });
});
