import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sourceFindMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { projectSource: { findMany: mocks.sourceFindMany } } }));
import { bucketCards, evidenceCounts, getProjectsBoard, orderEvidence, type BoardCard } from "./board";

const NOW = new Date("2026-10-27T18:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86400_000);

const card = (name: string, daysAgo: number | null, over: Partial<BoardCard> = {}): BoardCard => ({
  id: `inferred:${name}`,
  name,
  company: "Personal",
  visibility: "auto",
  lastActivityAt: daysAgo === null ? null : ago(daysAgo).toISOString(),
  status: null,
  next: null,
  evidence: [],
  stale: false,
  sourceId: name,
  ...over,
});

describe("bucketCards", () => {
  it("shows every non-hidden card, pinned first then newest; hidden apart", () => {
    const { cards, hidden } = bucketCards([
      card("old", 9, { company: "Infinite Machine" }),
      card("b-new", 1),
      card("a-new", 1),
      card("never", null),
      card("pin-old", 30, { visibility: "pinned" }),
      card("pin-new", 2, { visibility: "pinned" }),
      card("hid-old", 40, { visibility: "hidden" }),
      card("hid-new", 0, { visibility: "hidden" }),
    ]);
    expect(cards.map((c) => c.name)).toEqual(["pin-new", "pin-old", "a-new", "b-new", "old", "never"]);
    expect(hidden.map((c) => c.name)).toEqual(["hid-new", "hid-old"]);
  });
});

describe("evidence helpers", () => {
  const ev = (ref: string, kind: "meeting" | "email" | "todo" | "note", at: Date) => ({ ref, kind, title: ref, at: at.toISOString(), url: null });

  it("counts by kind", () => {
    expect(evidenceCounts([ev("a", "meeting", NOW), ev("b", "email", NOW), ev("c", "email", NOW)])).toEqual({
      meeting: 1,
      email: 2,
      todo: 0,
      note: 0,
    });
  });

  it("puts upcoming first (soonest first), then newest first", () => {
    const ordered = orderEvidence(
      [ev("past-old", "email", ago(5)), ev("soon", "meeting", ago(-1)), ev("past-new", "todo", ago(1)), ev("later", "meeting", ago(-3))],
      NOW,
    );
    expect(ordered.map((e) => e.ref)).toEqual(["soon", "later", "past-new", "past-old"]);
  });
});

describe("getProjectsBoard", () => {
  const row = (key: string, over: Record<string, unknown> = {}) => ({
    id: `id-${key}`,
    kind: "inferred",
    key,
    name: key,
    company: "Olto",
    description: `${key} status`,
    plan: [{ text: `${key} next` }],
    commits: [
      { ref: `gmail:${key}`, kind: "email", title: "Thread", at: ago(1).toISOString(), url: "https://mail.google.com/x" },
      { ref: `gcal:${key}`, kind: "meeting", title: "Review", at: ago(-2).toISOString(), url: null },
      { ref: "junk", kind: "commit", title: "x", at: ago(1).toISOString() },
    ],
    lastActivityAt: ago(1),
    state: "auto",
    ...over,
  });
  const run = (meta: Record<string, unknown>) => ({ ...row("latest"), kind: "inferred-run", state: "idle", plan: meta });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sourceFindMany.mockResolvedValue([
      row("erp-migration"),
      row("old-pinned", { state: "pinned", lastActivityAt: ago(20), company: "Nope" }),
      row("hid", { state: "hidden" }),
      row("weird", { state: "dismissed", plan: [] }),
      run({ lastCheckedAt: ago(0.1).toISOString(), lastSuccessAt: ago(0.5).toISOString(), keys: ["erp-migration", "hid", "weird"] }),
    ]);
  });

  it("gives a non-founder an empty board without querying", async () => {
    expect(await getProjectsBoard("u1", false, NOW)).toEqual({ cards: [], hidden: [], syncedAt: null, refreshFailed: false });
    expect(mocks.sourceFindMany).not.toHaveBeenCalled();
  });

  it("maps inferred rows to cards; the run row gives Synced and the stale flag", async () => {
    const board = await getProjectsBoard("u1", true, NOW);
    expect(mocks.sourceFindMany).toHaveBeenCalledWith({ where: { userId: "u1", kind: { in: ["inferred", "inferred-run"] } } });
    expect(board.cards.map((c) => c.name)).toEqual(["old-pinned", "erp-migration", "weird"]);
    expect(board.hidden.map((c) => c.name)).toEqual(["hid"]);
    expect(board.syncedAt).toBe(ago(0.1).toISOString());
    expect(board.refreshFailed).toBe(false);

    const c = board.cards.find((x) => x.name === "erp-migration")!;
    expect(c).toMatchObject({
      id: "inferred:id-erp-migration",
      sourceId: "id-erp-migration",
      company: "Olto",
      status: "erp-migration status",
      next: "erp-migration next",
      stale: false,
      lastActivityAt: ago(1).toISOString(),
    });
    // Unknown evidence kinds are dropped; upcoming first.
    expect(c.evidence.map((e) => e.ref)).toEqual(["gcal:erp-migration", "gmail:erp-migration"]);

    // Pinned and not returned by the latest run: stale. Unknown company / state fall back.
    expect(board.cards[0]).toMatchObject({ visibility: "pinned", stale: true, company: "Personal" });
    expect(board.cards.find((x) => x.name === "weird")).toMatchObject({ visibility: "auto", next: null });
  });

  it("flags a failed last run and survives a missing run row", async () => {
    mocks.sourceFindMany.mockResolvedValueOnce([row("a"), run({ lastCheckedAt: ago(1).toISOString(), error: "gmail: HTTP 429" })]);
    expect(await getProjectsBoard("u1", true, NOW)).toMatchObject({ refreshFailed: true, syncedAt: ago(1).toISOString() });
    mocks.sourceFindMany.mockResolvedValueOnce([row("a", { state: "pinned" })]);
    const board = await getProjectsBoard("u1", true, NOW);
    expect(board).toMatchObject({ refreshFailed: false, syncedAt: null });
    expect(board.cards[0].stale).toBe(false);
  });
});
