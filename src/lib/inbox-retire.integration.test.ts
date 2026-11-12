import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({ db: null as PrismaClient | null, parse: vi.fn(), userId: "" }));
vi.mock("@/lib/prisma", () => ({ get prisma() { if (!state.db) throw new Error("Test database not initialized"); return state.db; } }));
vi.mock("@/lib/smart-capture", () => ({ parseCapture: state.parse }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: vi.fn(async () => state.userId) }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: vi.fn(), deleteTodoEvent: vi.fn() }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: vi.fn() }));
import { captureMobile } from "@/lib/mobile-capture";
import { POST as reorder } from "@/app/api/todos/reorder/route";

// Retiring the Inbox list against the real schema: the moves, positions, row
// lock and cascade only mean something in Postgres.
const databaseUrl = process.env.CAPTURE_REVIEW_TEST_DATABASE_URL;
const users: string[] = [];
describe.skipIf(!databaseUrl)("retiring the Inbox list — real Postgres", () => {
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/capture_review_test")) throw new Error("Integration tests require the isolated local scratch database");
    state.db = new PrismaClient({ datasourceUrl: databaseUrl });
  });
  afterAll(async () => {
    if (state.db) { await state.db.user.deleteMany({ where: { id: { in: users } } }); await state.db.$disconnect(); }
  });
  async function user() {
    const id = "inbox-retire-test-" + randomUUID();
    await state.db!.user.create({ data: { id, email: id + "@example.test" } }); users.push(id); return id;
  }
  const db = () => state.db!;
  // Each call is a separate server process: no per-user cache.
  const fresh = async () => { vi.resetModules(); return (await import("@/lib/lists")).ensureDefaultLists; };
  const lists = async (userId: string) => (await db().list.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] })).map(l => [l.name, l.position, l.isDefault]);
  const titles = async (listId: string) => (await db().todo.findMany({ where: { listId, parentId: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] })).map(t => t.title);
  // The account as Inbox left it, with one or two default Inboxes at the top.
  async function inboxAccount(inboxes = 1) {
    const userId = await user();
    const made: Record<string, string> = {};
    for (let i = 0; i < inboxes; i++) made[`Inbox${i}`] = (await db().list.create({ data: { userId, name: "Inbox", color: "zinc", position: 0, isDefault: true } })).id;
    for (const [name, position, isDefault] of [["To Do", 1, true], ["Monitor", 2, true], ["Later", 3, true], ["EC/Obie", 5, false], ["Garage", 6, false]] as const) {
      made[name] = (await db().list.create({ data: { userId, name, position, isDefault, color: "zinc" } })).id;
    }
    return { userId, ids: made };
  }

  it("folds an Inbox into To Do: todos last in order, suggestions cleared, lists up one; a custom Inbox stays", async () => {
    const { userId, ids } = await inboxAccount();
    const inbox = ids.Inbox0, toDo = ids["To Do"];
    const custom = await db().list.create({ data: { userId, name: "Inbox", position: 7 } });
    await db().todo.create({ data: { userId, title: "Mine", listId: custom.id } });
    await db().todo.create({ data: { userId, title: "Already to do", listId: toDo, position: 4 } });
    const second = await db().todo.create({ data: { userId, title: "Second", listId: inbox, position: 1, suggestedListId: ids.Later } });
    const first = await db().todo.create({ data: { userId, title: "First", listId: inbox, position: 0, suggestedListId: toDo } });
    await db().todo.create({ data: { userId, title: "Sub", listId: inbox, parentId: first.id, position: 3 } });
    const elsewhere = await db().todo.create({ data: { userId, title: "Elsewhere", listId: ids.Garage, suggestedListId: inbox } });

    await (await fresh())(userId);

    expect(await lists(userId)).toEqual([["To Do", 0, true], ["Monitor", 1, true], ["Later", 2, true], ["EC/Obie", 4, false], ["Garage", 5, false], ["Inbox", 6, false]]);
    expect(await db().list.findUnique({ where: { id: inbox } })).toBeNull();
    expect(await titles(toDo)).toEqual(["Already to do", "First", "Second"]);
    expect((await db().todo.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { position: "asc" } })).map(t => [t.position, t.suggestedListId])).toEqual([[5, null], [6, null]]);
    expect(await db().todo.findFirstOrThrow({ where: { title: "Sub", userId } })).toMatchObject({ listId: toDo, parentId: first.id, position: 3 });
    expect(await db().todo.findUniqueOrThrow({ where: { id: elsewhere.id } })).toMatchObject({ listId: ids.Garage, suggestedListId: null });
    expect(await titles(custom.id)).toEqual(["Mine"]);
    expect(await db().todo.count({ where: { userId } })).toBe(6);
  });

  it("changes nothing when run again", async () => {
    const { userId, ids } = await inboxAccount();
    await db().todo.create({ data: { userId, title: "Captured", listId: ids.Inbox0 } });
    await (await fresh())(userId);
    const snapshot = async () => [await db().list.findMany({ where: { userId }, orderBy: { id: "asc" } }), await db().todo.findMany({ where: { userId }, orderBy: { id: "asc" } })];
    const before = await snapshot();
    await (await fresh())(userId);
    expect(await snapshot()).toEqual(before);
  });

  it("retires two Inboxes once each when four requests race", async () => {
    const { userId, ids } = await inboxAccount(2);
    for (let i = 0; i < 6; i++) await db().todo.create({ data: { userId, title: `T${i}`, listId: i % 2 ? ids.Inbox1 : ids.Inbox0, position: i } });
    const ensures = [];
    for (let i = 0; i < 4; i++) ensures.push(await fresh());
    await Promise.all(ensures.map(ensure => ensure(userId)));
    expect(await lists(userId)).toEqual([["To Do", 0, true], ["Monitor", 1, true], ["Later", 2, true], ["EC/Obie", 3, false], ["Garage", 4, false]]);
    expect(await titles(ids["To Do"])).toEqual(["T0", "T2", "T4", "T1", "T3", "T5"]);
    expect(new Set((await db().todo.findMany({ where: { userId } })).map(t => t.position)).size).toBe(6);
  });

  it("waits for a todo being written into the Inbox and moves it too", async () => {
    const { userId, ids } = await inboxAccount();
    let written!: () => void, release!: () => void;
    const isWritten = new Promise<void>(resolve => (written = resolve));
    const gate = new Promise<void>(resolve => (release = resolve));
    const writer = db().$transaction(async tx => {
      await tx.todo.create({ data: { userId, title: "Late capture", listId: ids.Inbox0 } });
      written();
      await gate;
    });
    await isWritten;
    const retire = (await fresh())(userId);
    // The retire is blocked on the list row until the writer commits.
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(await db().list.findUnique({ where: { id: ids.Inbox0 } })).not.toBeNull();
    release();
    await writer;
    await retire;
    expect(await titles(ids["To Do"])).toEqual(["Late capture"]);
    expect(await db().list.findUnique({ where: { id: ids.Inbox0 } })).toBeNull();
  });

  it("files a capture in To Do after its todos, with no suggestion, and keeps manual order", async () => {
    const userId = await user();
    state.userId = userId;
    await (await fresh())(userId);
    const toDo = await db().list.findFirstOrThrow({ where: { userId, isDefault: true, name: "To Do" } });
    await db().todo.create({ data: { userId, title: "Already", listId: toDo.id, position: 3 } });
    for (const title of ["First", "Second"]) {
      state.parse.mockResolvedValueOnce({ type: "todo", title, listName: "Later" });
      await captureMobile(userId, { requestId: randomUUID(), text: title, url: null, files: [] });
    }
    const todos = await db().todo.findMany({ where: { userId }, orderBy: { position: "asc" } });
    expect(todos.map(t => [t.title, t.listId, t.suggestedListId, t.position])).toEqual([
      ["Already", toDo.id, null, 3],
      ["First", toDo.id, null, 4],
      ["Second", toDo.id, null, 5],
    ]);
    expect(await db().list.count({ where: { userId, name: "Inbox" } })).toBe(0);
    const res = await reorder(new Request("https://example.test/api/todos/reorder", { method: "POST", body: JSON.stringify({ listId: toDo.id, ids: [todos[2].id, todos[0].id, todos[1].id] }) }));
    expect(res.status).toBe(200);
    expect(await titles(toDo.id)).toEqual(["Second", "Already", "First"]);
  });
});
