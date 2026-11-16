// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { CalendarView } from "./calendar-view";

const item = (id: string, title: string, dueDate: string) => ({
  id,
  title,
  dueDate,
  listId: "list-1",
  listColor: "blue",
  listName: "Errands",
  projectName: null,
});
const events = [item("t1", "Book flights", "2026-11-18"), item("s1", "Pack bag", "2026-11-19")];
// GET /api/todos?listId=list-1: the todo, and the subtask under its parent.
const listTodos = {
  todos: [
    {
      id: "t1",
      title: "Book flights",
      notes: "Window seat",
      subtasks: [{ id: "x1", title: "Check visa", notes: null, completedAt: null }],
    },
    {
      id: "p1",
      title: "Trip",
      notes: null,
      subtasks: [{ id: "s1", title: "Pack bag", notes: "Charger", completedAt: null }],
    },
  ],
};

type Call = [string, RequestInit | undefined];
let container: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>;
let patchStatus = 200;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  refresh.mockClear();
  patchStatus = 200;
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/todos?")) return Promise.resolve(Response.json(listTodos));
    if (url.startsWith("/api/attachments")) return Promise.resolve(Response.json({ attachments: [] }));
    if (url.endsWith("/comments")) return Promise.resolve(Response.json({ comments: [] }));
    if (init?.method === "PATCH") return Promise.resolve(new Response(null, { status: patchStatus }));
    return Promise.resolve(Response.json({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = () =>
  act(async () =>
    root.render(<CalendarView year={2026} month={10} events={events} upcoming={[events[0]]} />),
  );
// The month grid's row (the phone agenda and Upcoming render the same buttons).
const row = (title: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button[title]")].find((b) =>
    b.title.startsWith(title),
  )!;
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const modal = () => container.querySelector("[data-overlay=modal]");
const dueInput = () => container.querySelector<HTMLInputElement>('input[aria-label="Due date"]')!;
const patches = () =>
  (fetchMock.mock.calls as Call[])
    .filter(([, init]) => init?.method === "PATCH")
    .map(([url, init]) => [url, JSON.parse(String(init!.body))]);

// React tracks an input's value itself, so set it the way a browser would.
function setValue(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function closeWithDone() {
  const done = [...container.querySelectorAll("button")].find((b) => b.textContent === "Done")!;
  await click(done);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe("CalendarView opens a todo's detail", () => {
  it("opens Home's detail modal with the todo's notes, subtasks and due date", async () => {
    await render();
    expect(modal()).toBeNull();
    await click(row("Book flights"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/todos?listId=list-1");
    expect(modal()).not.toBeNull();
    expect(container.querySelector("textarea")!.value).toBe("Window seat");
    expect(modal()!.textContent).toContain("Check visa");
    expect(dueInput().value).toBe("2026-11-18");
  });

  it("finds a subtask under its parent", async () => {
    await render();
    await click(row("Pack bag"));
    expect(container.querySelector("textarea")!.value).toBe("Charger");
    expect(dueInput().value).toBe("2026-11-19");
  });

  it("changes the due date and refreshes the calendar on close", async () => {
    await render();
    await click(row("Book flights"));
    await act(async () => setValue(dueInput(), "2026-11-25"));
    // Nothing is sent while the date is being typed.
    expect(patches()).toEqual([]);
    await act(async () => {
      dueInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(patches()).toEqual([["/api/todos/t1", { dueDate: "2026-11-25" }]]);
    await closeWithDone();
    expect(refresh).toHaveBeenCalled();
    expect(modal()).toBeNull();
  });

  it("saves a date still in the input when the modal closes", async () => {
    await render();
    await click(row("Book flights"));
    await act(async () => setValue(dueInput(), "2026-12-01"));
    await closeWithDone();
    expect(patches()).toEqual([["/api/todos/t1", { dueDate: "2026-12-01" }]]);
    expect(refresh).toHaveBeenCalled();
  });

  it("removes the due date", async () => {
    await render();
    await click(row("Book flights"));
    const remove = [...container.querySelectorAll("button")].find((b) => b.textContent === "Remove")!;
    await click(remove);
    expect(patches()).toEqual([["/api/todos/t1", { dueDate: null }]]);
    expect(dueInput().value).toBe("");
  });

  it("puts the date back and doesn't refresh when the save fails", async () => {
    patchStatus = 500;
    await render();
    await click(row("Book flights"));
    const remove = [...container.querySelectorAll("button")].find((b) => b.textContent === "Remove")!;
    await click(remove);
    expect(dueInput().value).toBe("2026-11-18");
    expect(modal()!.textContent).toContain("Couldn’t save the date.");
    await closeWithDone();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes instead of opening a todo that's gone", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(Response.json(url.startsWith("/api/todos?") ? { todos: [] } : {})),
    );
    await render();
    await click(row("Book flights"));
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      "/api/todos?listId=list-1",
      "/api/todos?listId=list-1&includeCompleted=1",
    ]);
    expect(modal()).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });
});
