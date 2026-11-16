// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ListTile } from "./list-tile";
import { setTodoDrag } from "@/lib/todo-order";
import { FINE_POINTER_QUERY } from "@/lib/touch";

const MIME = "application/x-personalos-todo";
const MON = "2026-11-16T00:00:00.000Z";
const list = { id: "list-1", name: "Errands", color: "blue", isDefault: false };
// Home's order: undated in manual order, then dated.
const todos = [
  { id: "a", title: "Alpha", dueDate: null },
  { id: "b", title: "Bravo", dueDate: null },
  { id: "c", title: "Charlie", dueDate: null },
  { id: "d", title: "Delta", dueDate: MON },
];

let container: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === FINE_POINTER_QUERY,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  fetchMock = vi.fn(() => Promise.resolve(Response.json({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  setTodoDrag(null);
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = (props: { projectId?: string } = {}) =>
  act(async () => root.render(<ListTile list={list} todos={todos} totalCount={todos.length} {...props} />));
const order = () =>
  [...container.querySelectorAll<HTMLElement>("ul > li[data-kbd-todo]")].map((el) => el.dataset.kbdTodo);
const lines = () => container.querySelectorAll("[data-drop-line]");
const tile = () => container.querySelector("[data-droptarget-list]")!;

// Rows 40px tall from y=0, in DOM order (jsdom does no layout).
function layOut() {
  const rows = [...container.querySelectorAll<HTMLElement>("ul > li[data-kbd-todo]")];
  rows.forEach((el, i) => {
    el.getBoundingClientRect = () => ({ top: i * 40, height: 40 }) as DOMRect;
  });
}

function dragEvent(type: string, y: number, data: Record<string, string> = {}) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y });
  Object.defineProperty(ev, "dataTransfer", {
    value: { types: [MIME], getData: (k: string) => data[k] ?? "", dropEffect: "" },
  });
  return ev;
}
const payload = (id: string) => ({
  [MIME]: JSON.stringify({
    todoId: id,
    sourceListId: list.id,
    sourceProjectId: null,
    todo: todos.find((t) => t.id === id),
  }),
});

async function dragOwn(id: string, y: number) {
  setTodoDrag({ todoId: id, sourceListId: list.id });
  layOut();
  await act(async () => {
    tile().dispatchEvent(dragEvent("dragover", y));
  });
}
const drop = (id: string, y: number) =>
  act(async () => {
    tile().dispatchEvent(dragEvent("drop", y, payload(id)));
  });

describe("ListTile drag to reorder", () => {
  it("shows where the row will land and puts it there on drop", async () => {
    await render();
    expect(order()).toEqual(["a", "b", "c", "d"]);
    // Alpha over the lower half of Charlie: after Charlie.
    await dragOwn("a", 105);
    expect(lines()).toHaveLength(1);
    await drop("a", 105);
    expect(lines()).toHaveLength(0);
    expect(order()).toEqual(["b", "c", "a", "d"]);
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/todos/reorder");
    expect(JSON.parse(init.body)).toEqual({ listId: "list-1", ids: ["b", "c", "a", "d"] });
  });

  it("hands the order back to the server's snapshot once it's saved", async () => {
    await render();
    await dragOwn("a", 105);
    await drop("a", 105);
    const byId = (ids: string[]) => ids.map((id) => todos.find((t) => t.id === id)!);
    await act(async () =>
      root.render(<ListTile list={list} todos={byId(["b", "c", "a", "d"])} totalCount={4} />),
    );
    expect(order()).toEqual(["b", "c", "a", "d"]);
    // A later change from elsewhere shows as the server has it.
    await act(async () =>
      root.render(<ListTile list={list} todos={byId(["c", "b", "a", "d"])} totalCount={4} />),
    );
    expect(order()).toEqual(["c", "b", "a", "d"]);
  });

  it("keeps an undated todo above the dated ones", async () => {
    await render();
    // Alpha below Delta (dated) stops after Charlie, the last undated row.
    await dragOwn("a", 500);
    await drop("a", 500);
    expect(order()).toEqual(["b", "c", "a", "d"]);
  });

  it("shows no line and sends nothing where the row already is", async () => {
    await render();
    await dragOwn("b", 60);
    expect(lines()).toHaveLength(0);
    await drop("b", 60);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(order()).toEqual(["a", "b", "c", "d"]);
  });

  it("puts the order back when the request fails", async () => {
    let fail!: () => void;
    fetchMock.mockImplementation(
      () => new Promise((resolve) => (fail = () => resolve(new Response(null, { status: 500 })))),
    );
    await render();
    await dragOwn("c", 0);
    await drop("c", 0);
    // At once, before the server answers.
    expect(order()).toEqual(["c", "a", "b", "d"]);
    await act(async () => fail());
    expect(order()).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves project-scoped tiles to moves only", async () => {
    await render({ projectId: "p1" });
    await dragOwn("a", 105);
    expect(lines()).toHaveLength(0);
    const own = JSON.parse(payload("a")[MIME]);
    own.sourceProjectId = "p1";
    own.todo = { ...own.todo, projectId: "p1" };
    await act(async () => {
      tile().dispatchEvent(dragEvent("drop", 105, { [MIME]: JSON.stringify(own) }));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(order()).toEqual(["a", "b", "c", "d"]);
  });

  it("still moves a todo dropped from another list", async () => {
    await render();
    const other = {
      [MIME]: JSON.stringify({
        todoId: "x",
        sourceListId: "list-2",
        sourceProjectId: null,
        todo: { id: "x", title: "X-ray", projectId: null },
      }),
    };
    setTodoDrag({ todoId: "x", sourceListId: "list-2" });
    await act(async () => {
      tile().dispatchEvent(dragEvent("dragover", 10));
    });
    expect(lines()).toHaveLength(0);
    await act(async () => {
      tile().dispatchEvent(dragEvent("drop", 10, other));
    });
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/todos/x");
    expect(JSON.parse(init.body)).toEqual({ listId: "list-1", projectId: null });
  });
});
