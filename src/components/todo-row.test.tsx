// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { TodoRow } from "./todo-row";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Desktop: the (max-width: 767px) query does not match.
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

const todo = {
  id: "t1",
  title: "Buy tickets at www.example.com",
  notes: "context https://notes.example.org/page.",
};
const render = () =>
  act(async () =>
    root.render(
      <ul>
        <TodoRow todo={todo} sourceListId="list-1" />
      </ul>,
    ),
  );
const li = () => container.querySelector("li")!;
const titleText = () => container.querySelector("[data-todo-text]") as HTMLElement;
const wrapper = () => titleText().parentElement as HTMLElement;
const mouse = (el: EventTarget, type: string, x = 10, y = 10) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
  });

describe("TodoRow text selection and links", () => {
  it("links URLs in the notes line", async () => {
    await render();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://www.example.com", "https://notes.example.org/page"]);
    for (const a of container.querySelectorAll("a")) expect(a.getAttribute("draggable")).toBe("false");
  });

  it("stops the row being draggable while a press on the text is held", async () => {
    await render();
    expect(li().getAttribute("draggable")).toBe("true");
    await mouse(titleText(), "mousedown");
    expect(li().getAttribute("draggable")).toBe("false");
    await mouse(window, "mouseup");
    expect(li().getAttribute("draggable")).toBe("true");
  });

  it("keeps the row draggable when the press starts off the text (checkbox)", async () => {
    await render();
    await mouse(container.querySelector("button")!, "mousedown");
    expect(li().getAttribute("draggable")).toBe("true");
  });

  it("enters edit mode on a plain click", async () => {
    await render();
    await mouse(titleText(), "mousedown");
    await mouse(titleText(), "click");
    expect(wrapper().querySelector("input")).not.toBeNull();
  });

  it("does not enter edit mode after a drag-select", async () => {
    await render();
    await mouse(titleText(), "mousedown", 10, 10);
    await mouse(titleText(), "click", 60, 10);
    expect(wrapper().querySelector("input")).toBeNull();
  });

  it("does not enter edit mode while text is selected", async () => {
    await render();
    const range = document.createRange();
    range.selectNodeContents(titleText());
    window.getSelection()!.addRange(range);
    await mouse(titleText(), "mousedown");
    await mouse(titleText(), "click");
    expect(wrapper().querySelector("input")).toBeNull();
  });

  it("does not enter edit mode when a link in the notes is clicked", async () => {
    await render();
    const link = container.querySelector('a[href^="https://notes"]')!;
    link.addEventListener("click", (e) => e.preventDefault());
    await mouse(link, "mousedown");
    await mouse(link, "click");
    expect(wrapper().querySelector("input")).toBeNull();
  });
});
