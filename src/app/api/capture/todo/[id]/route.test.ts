import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  after: vi.fn(),
  syncRecentTodos: vi.fn(),
  deleteTodoEvent: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    todo: { findFirst: mocks.findFirst, update: mocks.update },
  },
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("@/lib/gcal", () => ({
  syncRecentTodos: mocks.syncRecentTodos,
  deleteTodoEvent: mocks.deleteTodoEvent,
}));
import { PATCH } from "./route";

const TOKEN = "test-capture-token";
const req = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
  new Request("https://example.invalid/api/capture/todo/t1", {
    method: "PATCH",
    headers: auth ? { authorization: auth } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (id = "t1") => ({ params: Promise.resolve({ id }) });
const select = { id: true, title: true, dueDate: true, completedAt: true };

let row: { id: string; title: string; dueDate: Date | null; completedAt: Date | null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CAPTURE_TOKEN", TOKEN);
  vi.stubEnv("FOUNDER_EMAIL", "founder@example.com");
  mocks.findUser.mockImplementation(async ({ where }: { where: { email: string } }) =>
    where.email === "founder@example.com" ? { id: "owner" } : null,
  );
  row = { id: "t1", title: "Call Alex Rivera", dueDate: null, completedAt: null };
  // Only the owner's todo exists; anything else (other user / other id) is null.
  mocks.findFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) =>
    where.id === "t1" && where.userId === "owner" ? { ...row } : null,
  );
  mocks.update.mockImplementation(async ({ data }: { data: Partial<typeof row> }) => {
    row = { ...row, ...data };
    return { ...row };
  });
  // Run scheduled background work inline so the Calendar hook is observable.
  mocks.after.mockImplementation((fn: () => unknown) => void fn());
});
afterEach(() => vi.unstubAllEnvs());

describe("PATCH /api/capture/todo/[id]", () => {
  it("401s without a valid bearer and touches no todo", async () => {
    for (const auth of [null, "Bearer wrong"]) {
      const res = await PATCH(req({ completed: true }, auth), ctx());
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("404s for a todo that isn't the caller's (or doesn't exist)", async () => {
    const res = await PATCH(req({ completed: true }), ctx("someone-elses"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "someone-elses", userId: "owner" },
      select,
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("completes a todo, stamps completedAt and syncs the Calendar mirror", async () => {
    const res = await PATCH(req({ completed: true }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: "t1",
      title: "Call Alex Rivera",
      dueDate: null,
      completedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "t1", userId: "owner" },
      data: { completedAt: expect.any(Date) },
      select,
    });
    expect(mocks.syncRecentTodos).toHaveBeenCalledOnce();
    expect(mocks.deleteTodoEvent).not.toHaveBeenCalled();
  });

  it("keeps the original completedAt when completing an already-completed todo", async () => {
    row.completedAt = new Date("2026-10-01T12:00:00.000Z");
    const res = await PATCH(req({ completed: true }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).completedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("uncompletes a todo by clearing completedAt only (same as the app's toggle)", async () => {
    row.completedAt = new Date("2026-10-01T12:00:00.000Z");
    const res = await PATCH(req({ completed: false }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).completedAt).toBeNull();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "t1", userId: "owner" },
      data: { completedAt: null },
      select,
    });
    expect(mocks.syncRecentTodos).toHaveBeenCalledOnce();
  });

  it("sets a date-only dueDate at UTC midnight and returns it as YYYY-MM-DD", async () => {
    const res = await PATCH(req({ dueDate: "2026-11-03" }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).dueDate).toBe("2026-11-03");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "t1", userId: "owner" },
      data: { dueDate: new Date("2026-11-03T00:00:00.000Z") },
      select,
    });
    expect(mocks.syncRecentTodos).toHaveBeenCalledOnce();
    expect(mocks.deleteTodoEvent).not.toHaveBeenCalled();
  });

  it("clears dueDate with null and deletes the Calendar event", async () => {
    row.dueDate = new Date("2026-11-03T00:00:00.000Z");
    const res = await PATCH(req({ dueDate: null }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).dueDate).toBeNull();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "t1", userId: "owner" },
      data: { dueDate: null },
      select,
    });
    expect(mocks.deleteTodoEvent).toHaveBeenCalledWith("t1");
    expect(mocks.syncRecentTodos).not.toHaveBeenCalled();
  });

  it("applies completed and dueDate together", async () => {
    const res = await PATCH(req({ completed: true, dueDate: "2026-11-04" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dueDate).toBe("2026-11-04");
    expect(body.completedAt).not.toBeNull();
    expect(mocks.syncRecentTodos).toHaveBeenCalledOnce();
  });

  it("400s on malformed dates, non-boolean completed and non-object bodies", async () => {
    for (const body of [
      { dueDate: "2026-02-30" },
      { dueDate: "2026-13-01" },
      { dueDate: "11/03/2026" },
      { dueDate: "2026-11-03T10:00:00Z" },
      { dueDate: 20261103 },
      { dueDate: "" },
      { completed: "yes" },
      "not json",
      [],
    ]) {
      const res = await PATCH(req(body), ctx());
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns the todo unchanged for an empty body without writing or syncing", async () => {
    row.dueDate = new Date("2026-11-03T00:00:00.000Z");
    const res = await PATCH(req({}), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "t1",
      title: "Call Alex Rivera",
      dueDate: "2026-11-03",
      completedAt: null,
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
