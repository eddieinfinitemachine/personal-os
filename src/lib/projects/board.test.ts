import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sourceFindMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { projectSource: { findMany: mocks.sourceFindMany } } }));
import { ACTIVITY_SHOWN, PLAN_SHOWN, bucketCards, getProjectsBoard, readPlan, type BoardCard } from "./board";

const NOW = new Date("2026-10-27T18:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86400_000);

const card = (name: string, daysAgo: number | null, over: Partial<BoardCard> = {}): BoardCard => ({
  id: `repo:${name}`,
  name,
  company: "Personal",
  visibility: "auto",
  lastActivityAt: daysAgo === null ? null : ago(daysAgo).toISOString(),
  activity: [],
  plan: [],
  planTotal: 0,
  githubUrl: null,
  homepageUrl: null,
  sourceId: name,
  ...over,
});

describe("bucketCards", () => {
  it("shows the last 14 days and pinned repos, collapses hidden ones, drops the rest", () => {
    const { cards, hidden } = bucketCards(
      [
        card("fresh", 1),
        card("edge", 13.9),
        card("stale", 14.1),
        card("ancient", 120),
        card("never", null),
        card("pinned-old", 300, { visibility: "pinned" }),
        card("hidden-new", 0, { visibility: "hidden" }),
        card("hidden-old", 400, { visibility: "hidden" }),
      ],
      NOW,
    );
    expect(cards.map((c) => c.name)).toEqual(["pinned-old", "fresh", "edge"]);
    expect(hidden.map((c) => c.name)).toEqual(["hidden-new", "hidden-old"]);
  });

  it("orders pinned first, then newest first, then by name; ignores company", () => {
    const { cards } = bucketCards(
      [
        card("old", 9, { company: "Infinite Machine" }),
        card("b-new", 1, { company: "Walden" }),
        card("a-new", 1),
        card("pin-old", 12, { visibility: "pinned" }),
        card("pin-new", 2, { visibility: "pinned", company: "Olto" }),
        card("newest", 0.1, { company: "Silo" }),
      ],
      NOW,
    );
    expect(cards.map((c) => c.name)).toEqual(["pin-new", "pin-old", "newest", "a-new", "b-new", "old"]);
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
  const repo = (id: string, daysAgo: number, over: Record<string, unknown> = {}) => ({
    id,
    key: `edcohen/${id}`,
    name: id,
    company: "Personal",
    state: "auto",
    url: `https://github.com/edcohen/${id}`,
    homepageUrl: null,
    lastActivityAt: ago(daysAgo),
    syncedAt: ago(0.01),
    commits: [],
    plan: [],
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sourceFindMany.mockResolvedValue([
      repo("rushmore", 1, {
        company: "Olto",
        homepageUrl: "https://rushmore.example",
        commits: [
          { oid: "a", message: "Oldest", at: ago(5).toISOString(), branch: null, url: "u-a" },
          { oid: "b", message: "Fix booking", at: ago(1).toISOString(), branch: "feat/x", url: "u-b" },
          { oid: "c", message: "Middle", at: ago(3).toISOString(), branch: null, url: "u-c" },
          { oid: "d", message: "Second", at: ago(2).toISOString(), branch: null, url: "u-d" },
        ],
        plan: { items: Array.from({ length: 8 }, (_, i) => ({ text: `Step ${i}`, section: "Now" })), total: 12 },
      }),
      repo("personal-os", 0.5, { syncedAt: ago(0.001) }),
      repo("old-pinned", 60, { state: "pinned", company: "Nope" }),
      repo("hid", 0.2, { state: "hidden" }),
      repo("stale", 30),
      repo("weird", 2, { state: "dismissed" }),
    ]);
  });

  it("gives a non-founder an empty board without querying", async () => {
    expect(await getProjectsBoard("u1", false, NOW)).toEqual({ cards: [], hidden: [], syncedAt: null });
    expect(mocks.sourceFindMany).not.toHaveBeenCalled();
  });

  it("builds one card per repo row: pinned first, then newest; hidden apart; stale dropped", async () => {
    const board = await getProjectsBoard("u1", true, NOW);
    expect(mocks.sourceFindMany).toHaveBeenCalledWith({ where: { userId: "u1", kind: "repo" } });
    expect(board.cards.map((c) => c.name)).toEqual(["old-pinned", "personal-os", "rushmore", "weird"]);
    expect(board.hidden.map((c) => c.name)).toEqual(["hid"]);
    // Unknown company / state fall back to Personal / auto.
    expect(board.cards[0]).toMatchObject({ company: "Personal", visibility: "pinned" });
    expect(board.cards.find((c) => c.name === "weird")!.visibility).toBe("auto");
    // The newest repo sync.
    expect(board.syncedAt).toBe(ago(0.001).toISOString());
  });

  it("shows the newest commits and the first plan items", async () => {
    const board = await getProjectsBoard("u1", true, NOW);
    const r = board.cards.find((c) => c.name === "rushmore")!;
    expect(r).toMatchObject({
      id: "repo:rushmore",
      sourceId: "rushmore",
      company: "Olto",
      visibility: "auto",
      lastActivityAt: ago(1).toISOString(),
      githubUrl: "https://github.com/edcohen/rushmore",
      homepageUrl: "https://rushmore.example",
      planTotal: 12,
    });
    expect(r.activity).toHaveLength(ACTIVITY_SHOWN);
    expect(r.activity.map((a) => `${a.kind}:${a.text}:${a.branch ?? ""}:${a.url}`)).toEqual([
      "commit:Fix booking:feat/x:u-b",
      "commit:Second::u-d",
      "commit:Middle::u-c",
    ]);
    expect(r.plan).toHaveLength(PLAN_SHOWN);
    expect(r.plan[0]).toEqual({ text: "Step 0", section: "Now" });
  });

  it("returns null syncedAt with no repos", async () => {
    mocks.sourceFindMany.mockResolvedValueOnce([]);
    expect(await getProjectsBoard("u1", true, NOW)).toEqual({ cards: [], hidden: [], syncedAt: null });
  });
});
