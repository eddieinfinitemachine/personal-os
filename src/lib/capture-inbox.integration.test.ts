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
import { ensureDefaultLists } from "@/lib/lists";
import { POST as reorder } from "@/app/api/todos/reorder/route";
import { PATCH } from "@/app/api/todos/[id]/route";

// Captures landing in the Inbox list, with suggestions, positions and manual
// order, against the real schema (including the 20261112 change file).
const databaseUrl = process.env.CAPTURE_REVIEW_TEST_DATABASE_URL;
const users: string[] = [];
describe.skipIf(!databaseUrl)("capture Inbox — real Postgres", () => {
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/capture_review_test")) throw new Error("Integration tests require the isolated local scratch database");
    state.db = new PrismaClient({ datasourceUrl: databaseUrl });
  });
  afterAll(async () => {
    if (state.db) { await state.db.user.deleteMany({ where: { id: { in: users } } }); await state.db.$disconnect(); }
  });
  async function user() {
    const id = "capture-inbox-test-" + randomUUID();
    await state.db!.user.create({ data: { id, email: id + "@example.test" } }); users.push(id); return id;
  }
  const db = () => state.db!;
  const capture = (userId: string, text: string) => captureMobile(userId, { requestId: randomUUID(), text, url: null, files: [] });
  const order = async (userId: string) => (await db().list.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] })).map(l => l.name);

  it("makes room for Inbox after To Do on an existing account and adopts a list already called inbox", async () => {
    const userId = await user();
    for (const [name, position, isDefault] of [["To Do", 0, true], ["Monitor", 1, true], ["Later", 2, true], ["Garage", 3, false], ["inbox", 4, false]] as const) {
      await db().list.create({ data: { userId, name, position, isDefault } });
    }
    await ensureDefaultLists(userId);
    expect(await order(userId)).toEqual(["To Do", "Inbox", "Monitor", "Later", "Garage"]);
    expect(await db().list.count({ where: { userId, name: { equals: "inbox", mode: "insensitive" } } })).toBe(1);
    expect(await db().list.findFirst({ where: { userId, name: "Inbox" } })).toMatchObject({ isDefault: true, color: "zinc", position: 1 });
  });

  it("files a capture in Inbox suggesting a shared list the user can edit, but not one they can only view", async () => {
    const [userId, owner] = [await user(), await user()];
    const wedding = await db().list.create({ data: { userId: owner, name: "Wedding", members: { create: { userId, role: "editor" } } } });
    await db().list.create({ data: { userId: owner, name: "Book Club", members: { create: { userId, role: "viewer" } } } });
    state.parse.mockResolvedValueOnce({ type: "todo", title: "Book the venue", listName: "wedding" });
    await capture(userId, "book the venue");
    expect(state.parse).toHaveBeenLastCalledWith(expect.objectContaining({ listNames: expect.arrayContaining(["Wedding"]) }));
    expect(state.parse.mock.lastCall![0].listNames).not.toContain("Book Club");
    state.parse.mockResolvedValueOnce({ type: "todo", title: "Pick a book", listName: "Book Club" });
    await capture(userId, "pick a book");
    const inbox = await db().list.findFirstOrThrow({ where: { userId, isDefault: true, name: "Inbox" } });
    const todos = await db().todo.findMany({ where: { userId }, orderBy: { position: "asc" } });
    expect(todos.map(t => [t.title, t.listId, t.suggestedListId, t.position])).toEqual([
      ["Book the venue", inbox.id, wedding.id, 0],
      ["Pick a book", inbox.id, null, 1],
    ]);
  });

  it("reorders, moves to the end of the suggested list (clearing the suggestion), and drops a deleted list's suggestion", async () => {
    const userId = await user();
    state.userId = userId;
    for (const title of ["First", "Second", "Third"]) {
      state.parse.mockResolvedValueOnce({ type: "todo", title, listName: "Later" });
      await capture(userId, title);
    }
    const inbox = await db().list.findFirstOrThrow({ where: { userId, name: "Inbox" } });
    const later = await db().list.findFirstOrThrow({ where: { userId, name: "Later" } });
    const [first, second, third] = await db().todo.findMany({ where: { userId }, orderBy: { position: "asc" } });
    expect([first, second, third].map(t => [t.title, t.suggestedListId])).toEqual([["First", later.id], ["Second", later.id], ["Third", later.id]]);

    const res = await reorder(new Request("https://example.test/api/todos/reorder", { method: "POST", body: JSON.stringify({ listId: inbox.id, ids: [third.id, first.id, second.id] }) }));
    expect(res.status).toBe(200);
    expect((await db().todo.findMany({ where: { listId: inbox.id }, orderBy: { position: "asc" } })).map(t => t.title)).toEqual(["Third", "First", "Second"]);

    await db().todo.create({ data: { userId, title: "Already later", listId: later.id, position: 5 } });
    const moved = await PATCH(new Request(`https://example.test/api/todos/${first.id}`, { method: "PATCH", body: JSON.stringify({ listId: later.id }) }), { params: Promise.resolve({ id: first.id }) });
    expect((await moved.json()).todo).toMatchObject({ id: first.id, listId: later.id, suggestedListId: null, position: 6 });

    await db().list.delete({ where: { id: later.id } });
    expect((await db().todo.findUniqueOrThrow({ where: { id: second.id } })).suggestedListId).toBeNull();
  });
});
