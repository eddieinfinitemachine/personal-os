import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gcal from "./gcal";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), token: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/google", () => ({ isGoogleConfigured: mocks.configured, getGoogleAccessToken: mocks.token }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const todo: gcal.TodoForCalendar = {
  id: "synthetic-todo", title: "Synthetic task", notes: null,
  dueDate: new Date("2026-11-02T00:00:00Z"), completedAt: null, droppedAt: null,
  list: { name: "Synthetic list" }, project: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("GOOGLE_CALENDAR_ID", "synthetic-calendar");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.configured.mockReturnValue(true);
  mocks.token.mockResolvedValue("synthetic-token");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("checked Google Calendar writes", () => {
  it("confirms a created event and keeps the void wrapper compatible", async () => {
    mocks.fetch.mockImplementation(async () => new Response(null, { status: 200 }));
    expect(await gcal.syncTodoEventChecked(todo)).toBe(true);
    expect(await gcal.syncTodoEvent(todo)).toBeUndefined();
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ id: gcal.eventIdForTodo(todo.id), summary: todo.title });
  });

  it.each([200, 403, 500])("checks the PATCH result after an existing deterministic event (%i)", async status => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 409 }));
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status }));
    expect(await gcal.syncTodoEventChecked(todo)).toBe(status === 200);
    expect(mocks.fetch.mock.calls[1][0]).toContain(gcal.eventIdForTodo(todo.id));
    expect(mocks.fetch.mock.calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).not.toHaveProperty("id");
  });

  it.each([200, 204, 404, 410, 403, 503])("confirms only successful or already absent deletes (%i)", async status => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status }));
    expect(await gcal.deleteTodoEventChecked(todo.id)).toBe([200, 204, 404, 410].includes(status));
    expect(mocks.fetch.mock.calls[0][1].method).toBe("DELETE");
  });

  it("reports an undated sync's delete failure", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await gcal.syncTodoEventChecked({ ...todo, dueDate: null })).toBe(false);
    expect(mocks.fetch.mock.calls[0][1].method).toBe("DELETE");
  });

  it("does not confirm failed creates or token refreshes", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await gcal.syncTodoEventChecked(todo)).toBe(false);
    mocks.token.mockRejectedValue(new Error("Synthetic refresh failure"));
    expect(await gcal.syncTodoEventChecked(todo)).toBe(false);
    expect(await gcal.deleteTodoEventChecked(todo.id)).toBe(false);
    expect(await gcal.deleteTodoEvent(todo.id)).toBeUndefined();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("retains retry state when Google is unconfigured", async () => {
    mocks.configured.mockReturnValue(false);
    expect(await gcal.syncTodoEventChecked(todo)).toBe(false);
    expect(await gcal.deleteTodoEventChecked(todo.id)).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
  });

  it("does not confirm calendar discovery failures", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_ID", "");
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await gcal.syncTodoEventChecked(todo)).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toContain("calendarList");
  });
});
