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
import { LOCK_MS, acquireRunLock, loadInferred, readRunMeta, saveFailed, saveInferred, saveUnchanged } from "./inferred-store";
import type { InferredProject } from "./infer";

const NOW = new Date("2026-10-27T18:00:00Z");
const RUN = { userId_kind_key: { userId: "u1", kind: "inferred-run", key: "latest" } };

const project = (key: string, over: Partial<InferredProject> = {}): InferredProject => ({
  key,
  name: key,
  company: "Olto",
  status: "Moving inventory",
  next: "Cutover call Tuesday",
  evidence: [{ ref: "gmail:1", kind: "email", title: "Cutover", at: NOW.toISOString(), url: null }],
  lastActivityAt: NOW.toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.updateMany.mockResolvedValue({ count: 1 });
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
  it("upserts returned projects, deletes unreturned auto rows only, and records the run, in one transaction", async () => {
    await saveInferred("u1", [project("erp"), project("launch", { next: null, lastActivityAt: null })], { hash: "h1", now: NOW });
    expect(db.transaction).toHaveBeenCalledOnce();
    const ops = db.transaction.mock.calls[0][0] as { op: string; args: Record<string, unknown> }[];
    expect(ops.map((o) => o.op)).toEqual(["upsert", "upsert", "deleteMany", "update"]);

    const first = ops[0].args as { create: Record<string, unknown>; update: Record<string, unknown>; where: unknown };
    expect(first.where).toEqual({ userId_kind_key: { userId: "u1", kind: "inferred", key: "erp" } });
    expect(first.create).toMatchObject({ kind: "inferred", key: "erp", state: "auto", description: "Moving inventory", plan: [{ text: "Cutover call Tuesday" }] });
    // A run never touches the user's pin / hide.
    expect(first.update).not.toHaveProperty("state");
    expect((ops[1].args as { update: Record<string, unknown> }).update).toMatchObject({ plan: [], lastActivityAt: null });

    expect(ops[2].args).toEqual({ where: { userId: "u1", kind: "inferred", state: "auto", key: { notIn: ["erp", "launch"] } } });
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
      { id: "1", key: "a", name: "A", company: "Silo", status: "s", next: "n", state: "pinned", refs: [], evidence: [], lastActivityAt: null },
    ]);
    expect(run).toMatchObject({ hash: "h", keys: [], error: null });
  });

  it("tolerates junk", () => {
    expect(readRunMeta([])).toEqual({ lastRunAt: null, lastCheckedAt: null, lastSuccessAt: null, hash: null, error: null, keys: [] });
  });
});
