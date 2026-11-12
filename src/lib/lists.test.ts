import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  listDelete: vi.fn(),
  lockList: vi.fn(),
  todoFindMany: vi.fn(),
  todoUpdate: vi.fn(),
  todoUpdateMany: vi.fn(),
  todoAggregate: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    list: { findFirst: mocks.findFirst, findMany: mocks.findMany, create: mocks.create, update: mocks.update, updateMany: mocks.updateMany, delete: mocks.listDelete },
    todo: { findMany: mocks.todoFindMany, update: mocks.todoUpdate, updateMany: mocks.todoUpdateMany, aggregate: mocks.todoAggregate },
    $queryRaw: mocks.lockList,
    $transaction: mocks.transaction,
  },
}));
import { prisma } from "@/lib/prisma";
import { DEFAULT_LISTS, ensureDefaultLists } from "./lists";

type ListRow = { id: string; userId: string; name: string; color: string; position: number; isDefault: boolean; createdAt: number };
type TodoRow = { id: string; listId: string; parentId: string | null; position: number; createdAt: number; suggestedListId: string | null };
type Where = { id?: string; userId?: string; isDefault?: boolean; name?: string; position?: { gt: number } };
type TodoWhere = { id?: string; listId?: string; parentId?: null; suggestedListId?: string };
let lists: ListRow[];
let todos: TodoRow[];
let serial: number;
let userSerial = 0;
// ensureDefaultLists caches per user and process, so each test gets a fresh user.
let user: string;

const matches = (l: ListRow, w: Where) =>
  (w.id === undefined || l.id === w.id) &&
  (w.userId === undefined || l.userId === w.userId) &&
  (w.isDefault === undefined || l.isDefault === w.isDefault) &&
  (w.name === undefined || l.name === w.name) &&
  (w.position === undefined || l.position > w.position.gt);
const todoMatches = (t: TodoRow, w: TodoWhere) =>
  (w.id === undefined || t.id === w.id) &&
  (w.listId === undefined || t.listId === w.listId) &&
  (w.parentId === undefined || t.parentId === w.parentId) &&
  (w.suggestedListId === undefined || t.suggestedListId === w.suggestedListId);
const add = (over: Partial<ListRow>) => {
  const row = { id: `list-${++serial}`, userId: user, name: "List", color: "zinc", position: 0, isDefault: false, createdAt: serial, ...over };
  lists.push(row);
  return row;
};
const addTodo = (over: Partial<TodoRow> & { listId: string }) => {
  const row = { id: `todo-${++serial}`, parentId: null, position: 0, createdAt: serial, suggestedListId: null, ...over };
  todos.push(row);
  return row;
};
const order = () => lists.filter((l) => l.userId === user).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt).map((l) => [l.name, l.position]);
// What a list shows: its top-level todos in read order.
const shown = (listId: string) => todos.filter((t) => t.listId === listId && !t.parentId).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt).map((t) => t.id);
// A second server process: no per-user cache.
const freshProcess = async () => { vi.resetModules(); return (await import("./lists")).ensureDefaultLists; };

beforeEach(() => {
  vi.clearAllMocks();
  lists = [];
  todos = [];
  serial = 0;
  user = `user-${++userSerial}`;
  // The transaction client is the same fake.
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  mocks.findFirst.mockImplementation(async ({ where }: { where: Where }) => lists.filter((l) => matches(l, where)).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null);
  mocks.findMany.mockImplementation(async ({ where }: { where: Where }) => lists.filter((l) => matches(l, where)).sort((a, b) => a.createdAt - b.createdAt));
  mocks.create.mockImplementation(async ({ data }: { data: Partial<ListRow> }) => add(data));
  mocks.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<ListRow> }) => Object.assign(lists.find((l) => l.id === where.id)!, data));
  mocks.updateMany.mockImplementation(async ({ where, data }: { where: Where; data: { position: { decrement: number } } }) => {
    const hit = lists.filter((l) => matches(l, where));
    hit.forEach((l) => (l.position -= data.position.decrement));
    return { count: hit.length };
  });
  mocks.listDelete.mockImplementation(async ({ where }: { where: { id: string } }) => {
    // Todo.listId cascades: anything left behind would go with the list.
    todos = todos.filter((t) => t.listId !== where.id);
    lists = lists.filter((l) => l.id !== where.id);
  });
  // SELECT "position" FROM "List" WHERE "id" = $1 FOR UPDATE
  mocks.lockList.mockImplementation(async (_sql: TemplateStringsArray, id: string) => lists.filter((l) => l.id === id).map(({ position }) => ({ position })));
  mocks.todoFindMany.mockImplementation(async ({ where }: { where: TodoWhere }) =>
    todos.filter((t) => todoMatches(t, where)).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt),
  );
  mocks.todoUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<TodoRow> }) => Object.assign(todos.find((t) => t.id === where.id)!, data));
  mocks.todoUpdateMany.mockImplementation(async ({ where, data }: { where: TodoWhere; data: Partial<TodoRow> }) => {
    const hit = todos.filter((t) => todoMatches(t, where));
    hit.forEach((t) => Object.assign(t, data));
    return { count: hit.length };
  });
  mocks.todoAggregate.mockImplementation(async ({ where }: { where: TodoWhere }) => {
    const positions = todos.filter((t) => todoMatches(t, where)).map((t) => t.position);
    return { _max: { position: positions.length ? Math.max(...positions) : null } };
  });
});

// An account as Inbox left it: Inbox first, the defaults after it, and the
// custom lists two places down (two requests each made room for an Inbox).
function inboxAccount() {
  const inbox = add({ name: "Inbox", color: "zinc", position: 0, isDefault: true });
  const toDo = add({ name: "To Do", color: "blue", position: 1, isDefault: true });
  add({ name: "Monitor", color: "orange", position: 2, isDefault: true });
  add({ name: "Later", color: "violet", position: 3, isDefault: true });
  add({ name: "Work", position: 5 });
  add({ name: "Garage", position: 6 });
  return { inbox, toDo };
}

describe("DEFAULT_LISTS", () => {
  it("is To Do, Monitor, Later, with no Inbox", () => {
    expect(DEFAULT_LISTS.map((l) => [l.name, l.position, l.color])).toEqual([
      ["To Do", 0, "blue"],
      ["Monitor", 1, "orange"],
      ["Later", 2, "violet"],
    ]);
  });
});

describe("ensureDefaultLists", () => {
  it("gives a new account To Do, Monitor, Later and no Inbox", async () => {
    await ensureDefaultLists(user);
    expect(order()).toEqual([["To Do", 0], ["Monitor", 1], ["Later", 2]]);
    expect(lists.every((l) => l.isDefault)).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("retires an empty Inbox: To Do back at 0, every other list up one in its order", async () => {
    inboxAccount();
    await ensureDefaultLists(user);
    expect(order()).toEqual([["To Do", 0], ["Monitor", 1], ["Later", 2], ["Work", 4], ["Garage", 5]]);
  });

  it("keeps a list reordered between the defaults where it was", async () => {
    inboxAccount();
    add({ name: "Wedding", position: 2 }); // beside Monitor
    await ensureDefaultLists(user);
    expect(order().map(([name]) => name)).toEqual(["To Do", "Monitor", "Wedding", "Later", "Work", "Garage"]);
  });

  it("moves the Inbox's todos after To Do's own, in their order, with no suggestion", async () => {
    const { inbox, toDo } = inboxAccount();
    const later = lists.find((l) => l.name === "Later")!;
    const mine = [addTodo({ listId: toDo.id, position: 0 }), addTodo({ listId: toDo.id, position: 7 })];
    const second = addTodo({ listId: inbox.id, position: 1, suggestedListId: later.id });
    const first = addTodo({ listId: inbox.id, position: 0, suggestedListId: toDo.id });
    const tied = addTodo({ listId: inbox.id, position: 1 }); // same position, created later
    const subtask = addTodo({ listId: inbox.id, parentId: first.id, position: 0 });
    await ensureDefaultLists(user);
    expect(shown(toDo.id)).toEqual([...mine.map((t) => t.id), first.id, second.id, tied.id]);
    expect([first, second, tied].map((t) => t.position)).toEqual([8, 9, 10]);
    expect(subtask).toMatchObject({ listId: toDo.id, position: 0 });
    expect(todos.every((t) => t.suggestedListId === null)).toBe(true);
    expect(lists.find((l) => l.id === inbox.id)).toBeUndefined();
  });

  it("clears suggestions pointing at the Inbox from todos elsewhere", async () => {
    const { inbox } = inboxAccount();
    const garage = lists.find((l) => l.name === "Garage")!;
    const elsewhere = addTodo({ listId: garage.id, suggestedListId: inbox.id });
    await ensureDefaultLists(user);
    expect(elsewhere).toMatchObject({ listId: garage.id, suggestedListId: null });
  });

  it("retires both Inboxes when a race made two", async () => {
    const { inbox, toDo } = inboxAccount();
    const twin = add({ name: "Inbox", color: "zinc", position: 0, isDefault: true });
    const a = addTodo({ listId: inbox.id });
    const b = addTodo({ listId: twin.id });
    await ensureDefaultLists(user);
    expect(lists.some((l) => l.name === "Inbox")).toBe(false);
    expect(shown(toDo.id)).toEqual([a.id, b.id]);
    expect(order()).toEqual([["To Do", 0], ["Monitor", 1], ["Later", 2], ["Work", 3], ["Garage", 4]]);
  });

  it("does nothing more when it runs again", async () => {
    const { inbox } = inboxAccount();
    addTodo({ listId: inbox.id });
    await ensureDefaultLists(user);
    const listsAfter = structuredClone(lists), todosAfter = structuredClone(todos);
    mocks.transaction.mockClear();
    await (await freshProcess())(user);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(lists).toEqual(listsAfter);
    expect(todos).toEqual(todosAfter);
  });

  it("skips an Inbox another request retired while it waited on the row lock", async () => {
    const { inbox, toDo } = inboxAccount();
    const todo = addTodo({ listId: inbox.id });
    // Both requests found the Inbox; the other one locks and retires it first.
    mocks.lockList.mockImplementationOnce(async (_sql: TemplateStringsArray, id: string) => {
      await (await freshProcess())(user);
      return lists.filter((l) => l.id === id).map(({ position }) => ({ position }));
    });
    await ensureDefaultLists(user);
    expect(order()).toEqual([["To Do", 0], ["Monitor", 1], ["Later", 2], ["Work", 4], ["Garage", 5]]);
    expect(shown(toDo.id)).toEqual([todo.id]);
    expect(mocks.listDelete).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it("leaves a list the user named Inbox themselves alone", async () => {
    add({ name: "To Do", color: "blue", position: 0, isDefault: true });
    add({ name: "Monitor", color: "orange", position: 1, isDefault: true });
    add({ name: "Later", color: "violet", position: 2, isDefault: true });
    const mine = add({ name: "Inbox", position: 3 });
    const todo = addTodo({ listId: mine.id });
    await ensureDefaultLists(user);
    expect(order()).toEqual([["To Do", 0], ["Monitor", 1], ["Later", 2], ["Inbox", 3]]);
    expect(todo.listId).toBe(mine.id);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("recreates To Do for an Inbox's todos when the account has none", async () => {
    const inbox = add({ name: "Inbox", color: "zinc", position: 0, isDefault: true });
    const todo = addTodo({ listId: inbox.id, position: 3 });
    await ensureDefaultLists(user);
    const toDo = lists.find((l) => l.name === "To Do")!;
    expect(toDo).toMatchObject({ isDefault: true, position: 0 });
    expect(todo).toMatchObject({ listId: toDo.id, position: 0 });
    expect(order().map(([name]) => name)).toEqual(["To Do", "Monitor", "Later"]);
  });
});
