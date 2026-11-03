import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  createMany: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    projectSource: {
      createMany: db.createMany,
      updateMany: db.updateMany,
      findMany: db.findMany,
      findUnique: db.findUnique,
      upsert: db.upsert,
      deleteMany: db.deleteMany,
      update: db.update,
    },
    $transaction: db.transaction,
  },
}));
import { LOCK_MS, QUIET_KEEP_MS, acquireRunLock, cardsToRemove, loadInferred, readRunMeta, saveFailed, saveInferred, saveUnchanged } from "./inferred-store";
import type { InferredProject } from "./infer";

const NOW = new Date("2026-10-27T18:00:00Z");
const RUN = { userId_kind_key: { userId: "u1", kind: "inferred-run", key: "latest" } };

const project = (key: string, over: Partial<InferredProject> = {}): InferredProject => ({
  key,
  name: key,
  company: "Olto",
  status: "Moving inventory",
  problem: null,
  steps: [{ text: "Cutover call Tuesday", due: "2026-10-27", who: "Eddie", waiting: false }],
  next: "Cutover call Tuesday",
  evidence: [{ ref: "gmail:1", kind: "email", title: "Cutover", at: NOW.toISOString(), url: null }],
  lastActivityAt: NOW.toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.updateMany.mockResolvedValue({ count: 1 });
  db.findMany.mockResolvedValue([]);
  db.findUnique.mockResolvedValue({ plan: { lastSuccessAt: "2026-10-26T00:00:00.000Z", hash: "old", keys: ["x"] } });
  db.upsert.mockImplementation((args) => ({ op: "upsert", args }));
  db.deleteMany.mockImplementation((args) => ({ op: "deleteMany", args }));
  db.update.mockImplementation((args) => ({ op: "update", args }));
  db.transaction.mockImplementation(async (ops: unknown[]) => ops);
});

describe("acquireRunLock", () => {
  it("creates the run row if needed, then takes the lock only when free or stale", async () => {
    expect(await acquireRunLock("u1", NOW)).toBe(true);
    expect(db.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [{ kind: "inferred-run", key: "latest", state: "idle" }] });
    expect(db.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        kind: "inferred-run",
        key: "latest",
        OR: [{ state: { not: "running" } }, { lastActivityAt: null }, { lastActivityAt: { lt: new Date(NOW.getTime() - LOCK_MS) } }],
      },
      data: { state: "running", lastActivityAt: NOW },
    });
    db.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await acquireRunLock("u1", NOW)).toBe(false);
  });
});

describe("saveInferred", () => {
  it("upserts returned projects, removes what should go, and records the run, in one transaction", async () => {
    await saveInferred("u1", [project("erp"), project("launch", { steps: [], next: null, lastActivityAt: null })], { hash: "h1", now: NOW });
    expect(db.transaction).toHaveBeenCalledOnce();
    const ops = db.transaction.mock.calls[0][0] as { op: string; args: Record<string, unknown> }[];
    expect(ops.map((o) => o.op)).toEqual(["upsert", "upsert", "deleteMany", "update"]);

    const first = ops[0].args as { create: Record<string, unknown>; update: Record<string, unknown>; where: unknown };
    expect(first.where).toEqual({ userId_kind_key: { userId: "u1", kind: "inferred", key: "erp" } });
    expect(first.create).toMatchObject({ kind: "inferred", key: "erp", state: "auto", description: "Moving inventory", plan: [{ text: "Cutover call Tuesday", due: "2026-10-27", who: "Eddie", waiting: false }] });
    // A run never touches the user's pin / hide.
    expect(first.update).not.toHaveProperty("state");
    expect((ops[1].args as { update: Record<string, unknown> }).update).toMatchObject({ plan: [], lastActivityAt: null });

    expect(ops[2].args).toEqual({ where: { userId: "u1", kind: "inferred", state: "auto", key: { in: [] } } });
    expect(ops[3].args).toEqual({
      where: RUN,
      data: {
        state: "idle",
        lastActivityAt: null,
        plan: {
          lastRunAt: NOW.toISOString(),
          lastCheckedAt: NOW.toISOString(),
          lastSuccessAt: NOW.toISOString(),
          hash: "h1",
          error: null,
          keys: ["erp", "launch"],
        },
      },
    });
  });
});

describe("the plan column", () => {
  const row = (plan: unknown) => ({ id: "1", kind: "inferred", key: "a", name: "A", company: "Silo", description: null, plan, commits: [], lastActivityAt: null, state: "auto" });

  it("stores steps, then the problem last, keeping plan[0].text readable by the old reader", async () => {
    await saveInferred("u1", [project("erp", { problem: "Deposit stuck" })], { hash: "h", now: NOW });
    const plan = (db.upsert.mock.calls[0][0] as { create: { plan: { text: string }[] } }).create.plan;
    expect(plan[0].text).toBe("Cutover call Tuesday");
    expect(plan.at(-1)).toEqual({ type: "problem", text: "Deposit stuck" });
  });

  it("reads old rows, new rows and problem-only rows", async () => {
    db.findMany.mockResolvedValue([
      row([{ text: "Old next" }]),
      row([{ text: "Step", due: "2026-11-01", who: "Vendor", waiting: true }, { type: "problem", text: "Late" }]),
      row([{ type: "problem", text: "Stuck" }]),
    ]);
    const { projects } = await loadInferred("u1");
    expect(projects[0]).toMatchObject({ next: "Old next", problem: null, steps: [{ text: "Old next", due: null, who: null, waiting: false }] });
    expect(projects[1]).toMatchObject({ next: "Step", problem: "Late", steps: [{ text: "Step", due: "2026-11-01", who: "Vendor", waiting: true }] });
    // A problem is never shown as the next step.
    expect(projects[2]).toMatchObject({ next: null, problem: "Stuck", steps: [] });
  });
});

describe("lastActivityAt", () => {
  it("never moves backwards as the evidence window rolls on", async () => {
    const later = new Date(NOW.getTime() + 3600_000);
    db.findMany.mockResolvedValue([{ key: "erp", state: "auto", lastActivityAt: later, plan: [], commits: [] }]);
    await saveInferred("u1", [project("erp"), project("new", { lastActivityAt: null })], { hash: "h", now: NOW });
    const updates = db.upsert.mock.calls.map((c) => (c[0] as { update: { lastActivityAt: Date | null } }).update.lastActivityAt);
    expect(updates[0]).toEqual(later);
    expect(updates[1]).toBeNull();
  });
});

describe("cardsToRemove", () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  const DAY = 86400_000;
  const row = (key: string, over: Record<string, unknown> = {}) => ({
    id: key,
    key,
    name: key,
    company: "Olto",
    description: "Going fine",
    plan: [],
    commits: [{ ref: `gmail:${key}`, kind: "email", title: "Thread", at: ago(DAY).toISOString(), url: null }],
    lastActivityAt: ago(DAY),
    createdAt: ago(40 * DAY),
    state: "auto",
    ...over,
  });
  const remove = (rows: ReturnType<typeof row>[], opts: { returned?: InferredProject[]; rejectedKeys?: string[]; isSensitive?: (t: string) => boolean } = {}) =>
    cardsToRemove(rows as never, opts.returned ?? [], { now: NOW, ...opts });

  it("keeps a quiet card until 30 days after its last activity", () => {
    const rows = [row("recent", { lastActivityAt: ago(QUIET_KEEP_MS - DAY) }), row("expired", { lastActivityAt: ago(QUIET_KEEP_MS + DAY) })];
    expect(remove(rows)).toEqual(["expired"]);
  });

  it("falls back to createdAt when a card has no past activity, so it can still expire", () => {
    const rows = [row("old", { lastActivityAt: null, createdAt: ago(QUIET_KEEP_MS + DAY) }), row("new", { lastActivityAt: null, createdAt: ago(DAY) })];
    expect(remove(rows)).toEqual(["old"]);
  });

  it("removes flagged cards at once", () => {
    expect(remove([row("a")], { rejectedKeys: ["a"] })).toEqual(["a"]);
  });

  it("re-checks stored text every run: name, status, problem, steps, who and evidence titles", () => {
    const gate = (t: string) => /secret/i.test(t);
    const rows = [
      row("clean"),
      row("named", { name: "Secret plan" }),
      row("status", { description: "secret" }),
      row("step", { plan: [{ text: "Call the secret" }] }),
      row("who", { plan: [{ text: "Call", who: "Secret Co" }] }),
      row("problem", { plan: [{ type: "problem", text: "secret" }] }),
      row("evidence", { commits: [{ ref: "gmail:e", kind: "email", title: "Secret thread", at: ago(DAY).toISOString(), url: null }] }),
    ];
    expect(remove(rows, { isSensitive: gate })).toEqual(["named", "status", "step", "who", "problem", "evidence"]);
  });

  it("removes a card most of whose evidence moved to a returned card, but not one sharing a little", () => {
    const ev = (ref: string) => ({ ref, kind: "email", title: "T", at: ago(DAY).toISOString(), url: null });
    const rows = [row("renamed", { commits: [ev("gmail:1"), ev("gmail:2")] }), row("separate", { commits: [ev("gmail:1"), ev("gmail:7"), ev("gmail:8")] })];
    const returned = [project("new-name", { evidence: [{ ref: "gmail:1", kind: "email", title: "T", at: NOW.toISOString(), url: null }] })];
    expect(remove(rows, { returned })).toEqual(["renamed"]);
  });

  it("never touches returned, pinned, hidden or finished cards", () => {
    const expired = { lastActivityAt: ago(QUIET_KEEP_MS * 2) };
    const rows = [row("back", expired), row("pin", { ...expired, state: "pinned" }), row("hid", { ...expired, state: "hidden" }), row("done", { ...expired, state: "finished" })];
    expect(remove(rows, { returned: [project("back")], rejectedKeys: ["pin", "hid", "done"], isSensitive: () => true })).toEqual([]);
  });
});

describe("saveFailed / saveUnchanged", () => {
  it("a failure writes only the run row: error class, lock released, last success kept", async () => {
    await saveFailed("u1", "gmail: HTTP 429", NOW);
    expect(db.upsert).not.toHaveBeenCalled();
    expect(db.deleteMany).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.update.mock.calls[0][0]).toEqual({
      where: RUN,
      data: {
        state: "idle",
        lastActivityAt: null,
        plan: {
          lastRunAt: NOW.toISOString(),
          lastCheckedAt: null,
          lastSuccessAt: "2026-10-26T00:00:00.000Z",
          hash: "old",
          error: "gmail: HTTP 429",
          keys: ["x"],
        },
      },
    });
  });

  it("unchanged records the check and clears the error", async () => {
    await saveUnchanged("u1", NOW);
    expect(db.update.mock.calls[0][0].data.plan).toMatchObject({ lastCheckedAt: NOW.toISOString(), error: null, hash: "old" });
  });
});

describe("loadInferred / readRunMeta", () => {
  it("splits project rows from the run row", async () => {
    db.findMany.mockResolvedValue([
      { id: "1", kind: "inferred", key: "a", name: "A", company: "Silo", description: "s", plan: [{ text: "n" }], commits: [], lastActivityAt: null, state: "pinned" },
      { id: "r", kind: "inferred-run", key: "latest", name: "", company: "Personal", description: null, plan: { hash: "h" }, commits: [], lastActivityAt: null, state: "idle" },
    ]);
    const { projects, run } = await loadInferred("u1");
    expect(projects).toEqual([
      { id: "1", key: "a", name: "A", company: "Silo", status: "s", next: "n", problem: null, steps: [{ text: "n", due: null, who: null, waiting: false }], state: "pinned", refs: [], evidence: [], lastActivityAt: null },
    ]);
    expect(run).toMatchObject({ hash: "h", keys: [], error: null });
  });

  it("tolerates junk", () => {
    expect(readRunMeta([])).toEqual({ lastRunAt: null, lastCheckedAt: null, lastSuccessAt: null, hash: null, error: null, keys: [] });
  });
});
