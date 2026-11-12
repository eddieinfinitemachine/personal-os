// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getLists: vi.fn(), pushTodoMoveUndo: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/todo-menu-cache", () => ({ getLists: mocks.getLists }));
vi.mock("@/lib/todo-undo", () => ({ pushTodoMoveUndo: mocks.pushTodoMoveUndo }));

import { TodoRow, type TodoLike } from "./todo-row";

let container: HTMLDivElement, root: Root, fetch: ReturnType<typeof vi.fn>, moved: CustomEvent[];
const onMoved = (e: Event) => moved.push(e as CustomEvent);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetch);
  mocks.getLists.mockResolvedValue([
    { id: "inbox", name: "Inbox", color: "zinc" },
    { id: "later", name: "Later", color: "violet" },
  ]);
  moved = [];
  window.addEventListener("personalos:todo-moved", onMoved);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.removeEventListener("personalos:todo-moved", onMoved);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const render = (todo: TodoLike, sourceListId = "inbox") =>
  act(async () => root.render(<ul><TodoRow todo={todo} sourceListId={sourceListId} /></ul>));
const chip = () => container.querySelector("button[data-list-suggestion]") as HTMLButtonElement | null;

describe("TodoRow list suggestion chip", () => {
  it("offers the suggested list and moves the todo there in one click, with undo", async () => {
    await render({ id: "t1", title: "Read: Synthetic Essay", suggestedListId: "later" });
    expect(chip()?.textContent).toBe("Later");
    expect(chip()?.title).toBe("Move to Later");
    await act(async () => chip()!.click());
    expect(fetch).toHaveBeenCalledWith("/api/todos/t1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ listId: "later" }) }));
    // Optimistic move event, same as the "Move to…" menu.
    expect(moved[0].detail).toMatchObject({ todoId: "t1", fromListId: "inbox", toListId: "later" });
    expect(mocks.pushTodoMoveUndo).toHaveBeenCalledWith(expect.objectContaining({ label: "Moved \u201cRead: Synthetic Essay\u201d to Later", to: { listId: "later", projectId: null } }));
  });

  it.each([
    ["no suggestion", { suggestedListId: null }, "inbox"],
    ["already on the suggested list", { suggestedListId: "later" }, "later"],
    ["a list that no longer exists", { suggestedListId: "gone" }, "inbox"],
    ["a completed todo", { suggestedListId: "later", completedAt: "2026-11-12T10:00:00Z" }, "inbox"],
  ] as const)("shows no chip for %s", async (_label, extra, sourceListId) => {
    await render({ id: "t1", title: "Task", ...extra }, sourceListId);
    expect(chip()).toBeNull();
  });
});
