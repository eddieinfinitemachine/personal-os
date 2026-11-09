import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  after: vi.fn(),
  syncRecentTodos: vi.fn(),
  deleteTodoEvent: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { todo: { findFirst: mocks.findFirst, update: mocks.update } },
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
    where.id === "t1" ? { id: "t1", completedAt: null } : null,
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
