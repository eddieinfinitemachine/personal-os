import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findFirst: vi.fn(),
  findList: vi.fn(),
  aggregate: vi.fn(),
  update: vi.fn(),
  after: vi.fn(),
  syncRecentTodos: vi.fn(),
  deleteTodoEvent: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    todo: { findFirst: mocks.findFirst, update: mocks.update, aggregate: mocks.aggregate },
    list: { findFirst: mocks.findList },
  },
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: mocks.syncRecentTodos, deleteTodoEvent: mocks.deleteTodoEvent }));
vi.mock("@/lib/todo-delete", () => ({ deleteTodo: vi.fn() }));
import { PATCH } from "./route";

const patch = (body: unknown, id = "t1") =>
  PATCH(
    new Request(`https://example.invalid/api/todos/${id}`, {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === "t1" ? { id: "t1", completedAt: null, listId: "inbox", parentId: null, suggestedListId: "later" } : null,
  );
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "t1", title: "Call the bank", ...data }));
  mocks.after.mockImplementation((fn: () => unknown) => void fn());
});

describe("PATCH /api/todos/[id]: JSON and dueDate", () => {
  it("still 404s an inaccessible todo before reading the body", async () => {
    const res = await patch("{not json", "other");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it.each(["{not json", "", "[]", "null", '"2026-11-09"'])("400s a body that isn't a JSON object: %j", async (body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    "2026-02-30",
    "2026-11-9",
    "2026-11-09T00:00:00.000Z",
    "tomorrow",
    "",
    20261109,
    true,
  ])("400s dueDate %j instead of storing an Invalid Date", async (dueDate) => {
    const res = await patch({ dueDate });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "dueDate must be YYYY-MM-DD or null" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("stores a calendar day as UTC midnight and syncs the calendar", async () => {
    const res = await patch({ dueDate: "2026-11-09" });
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { dueDate: new Date("2026-11-09T00:00:00.000Z") } });
    expect(mocks.syncRecentTodos).toHaveBeenCalled();
    expect(mocks.deleteTodoEvent).not.toHaveBeenCalled();
  });

  it("clears the date with null and deletes the calendar event", async () => {
    const res = await patch({ dueDate: null });
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { dueDate: null } });
    expect(mocks.deleteTodoEvent).toHaveBeenCalledWith("t1");
  });

  it("leaves other edits as they were", async () => {
    const res = await patch({ title: "Call the bank today", toggleComplete: true });
    expect(res.status).toBe(200);
    const { data } = mocks.update.mock.calls[0][0];
    expect(data.title).toBe("Call the bank today");
    expect(data.completedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty("dueDate");
  });
});

describe("PATCH /api/todos/[id]: moving lists", () => {
  beforeEach(() => {
    mocks.findList.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "nope" ? null : { id: where.id }));
    mocks.aggregate.mockResolvedValue({ _max: { position: 11 } });
  });

  it("accepts a suggestion: moves the todo to the end of the target list and clears the suggestion", async () => {
    const res = await patch({ listId: "later" });
    expect(res.status).toBe(200);
    expect(mocks.aggregate).toHaveBeenCalledWith({ where: { listId: "later", parentId: null }, _max: { position: true } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { listId: "later", suggestedListId: null, position: 12 } });
    // The full row comes back, suggestion included.
    expect((await res.json()).todo).toMatchObject({ id: "t1", listId: "later", suggestedListId: null, position: 12 });
  });

  it("clears the suggestion on any move, not just to the suggested list", async () => {
    await patch({ listId: "monitor" });
    expect(mocks.update.mock.calls[0][0].data).toEqual({ listId: "monitor", suggestedListId: null, position: 12 });
  });

  it("keeps the suggestion and position when listId doesn't change", async () => {
    await patch({ listId: "inbox", title: "Renamed" });
    expect(mocks.update.mock.calls[0][0].data).toEqual({ title: "Renamed", listId: "inbox" });
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });

  it("keeps the suggestion through other edits", async () => {
    await patch({ toggleComplete: true });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("suggestedListId");
  });

  it("moves a subtask without touching its position", async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: "t1", completedAt: null, listId: "inbox", parentId: "p1", suggestedListId: null });
    await patch({ listId: "later" });
    expect(mocks.update.mock.calls[0][0].data).toEqual({ listId: "later", suggestedListId: null });
  });

  it("404s an inaccessible target list without writing", async () => {
    const res = await patch({ listId: "nope" });
    expect(res.status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
