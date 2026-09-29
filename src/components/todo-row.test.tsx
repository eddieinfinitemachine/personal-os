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
    expect(wrapper().querySelector("textarea")).not.toBeNull();
  });

  it("does not enter edit mode after a drag-select", async () => {
    await render();
    await mouse(titleText(), "mousedown", 10, 10);
    await mouse(titleText(), "click", 60, 10);
    expect(wrapper().querySelector("textarea")).toBeNull();
  });

  it("does not enter edit mode while text is selected", async () => {
    await render();
    const range = document.createRange();
    range.selectNodeContents(titleText());
    window.getSelection()!.addRange(range);
    await mouse(titleText(), "mousedown");
    await mouse(titleText(), "click");
    expect(wrapper().querySelector("textarea")).toBeNull();
  });

  it("does not enter edit mode when a link in the notes is clicked", async () => {
    await render();
    const link = container.querySelector('a[href^="https://notes"]')!;
    link.addEventListener("click", (e) => e.preventDefault());
    await mouse(link, "mousedown");
    await mouse(link, "click");
    expect(wrapper().querySelector("textarea")).toBeNull();
  });
});

describe("TodoRow send to tracker", () => {
  type Call = { url: string; init?: RequestInit };
  let calls: Call[];
  let resolveSend: (r: Response) => void;
  beforeEach(() => {
    calls = [];
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === "/api/projects")
          return Promise.resolve(Response.json({ projects: [{ id: "p1", name: "Journal" }] }));
        if (url.endsWith("/to-tracker"))
          return new Promise<Response>((r) => (resolveSend = r));
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );
  });
  afterEach(() => localStorage.clear());

  const openPicker = async () => {
    await render();
    await act(async () => {
      (container.querySelector("[data-project-picker]") as HTMLElement).click();
    });
    return document.body.querySelector("[data-project-picker-popover]") as HTMLElement;
  };

  it("lists no trackers when none are enabled", async () => {
    const pop = await openPicker();
    expect(pop).not.toBeNull();
    expect(pop.querySelector("[data-send-to-tracker]")).toBeNull();
  });

  it("offers enabled asset trackers and sends the todo to one", async () => {
    localStorage.setItem("personalos:enabled-templates", JSON.stringify(["media", "trips"]));
    const pop = await openPicker();
    const section = pop.querySelector("[data-send-to-tracker]") as HTMLElement;
    expect(section.textContent).toContain("Send to tracker");
    const buttons = [...section.querySelectorAll("button")].map((b) => b.textContent);
    // Trips isn't an Asset tracker.
    expect(buttons).toEqual(["Media"]);

    await act(async () => section.querySelector("button")!.click());
    const send = calls.find((c) => c.url === "/api/todos/t1/to-tracker")!;
    expect(send.init?.method).toBe("POST");
    expect(JSON.parse(String(send.init?.body))).toEqual({ kind: "media" });
    // Picker closes; the row says what it's doing while Claude works.
    expect(document.body.querySelector("[data-project-picker-popover]")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Sending to Media…");

    const { peekUndo } = await import("@/lib/undo");
    await act(async () =>
      resolveSend(Response.json({ asset: { id: "a1" }, todo: { id: "t1", title: todo.title, listId: "list-1" } })),
    );
    const undo = peekUndo()!;
    expect(undo.label).toContain("to Media");
    await act(async () => undo.run());
    const del = calls.find((c) => c.url === "/api/assets/a1")!;
    expect(del.init?.method).toBe("DELETE");
    const restore = calls.find((c) => c.url === "/api/todos/restore")!;
    expect(JSON.parse(String(restore.init?.body))).toEqual({
      todo: { id: "t1", title: todo.title, listId: "list-1" },
    });
  });

  it("shows a retry hint when the send fails", async () => {
    localStorage.setItem("personalos:enabled-templates", JSON.stringify(["media"]));
    const pop = await openPicker();
    await act(async () => (pop.querySelector("[data-send-to-tracker] button") as HTMLElement).click());
    await act(async () => resolveSend(Response.json({ error: "x" }, { status: 502 })));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("try again");
    expect(titleText().textContent).toBe(todo.title);
  });
});
