// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./list-tile", () => ({
  ListTile: ({ list }: { list: { name: string } }) => <div>{list.name}</div>,
}));
vi.mock("./call-sheet-shortcut", () => ({
  CallSheetShortcut: () => null,
  useCallSheetProgress: () => null,
}));

import { HomeTiles, type HomeTile } from "./home-tiles";

const tile = (id: string, name: string): HomeTile => ({
  list: { id, name, color: "blue", isDefault: false },
  todos: [],
  totalCount: 0,
});
const tiles = [tile("a", "To Do"), tile("b", "Monitor"), tile("c", "Later")];

let container: HTMLDivElement, root: Root;
let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Run the scroll handler's rAF on the next microtask (inside act).
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(0));
    return 1;
  });
  // The unfolded Duo: a 951px track of 400px columns. jsdom has no layout.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-pager-column") ? 400 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-pager-track") ? 951 : 0;
  });
  scrollTo = vi.fn();
  HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const render = () => act(async () => root.render(<HomeTiles tiles={tiles} />));
const track = () => container.querySelector<HTMLElement>("[data-pager-track]")!;
const pill = (name: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="Go to ${name}"]`)!;
const scrollTrackTo = (left: number) =>
  act(async () => {
    track().scrollLeft = left;
    track().dispatchEvent(new Event("scroll"));
  });
const activePill = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button[aria-label^='Go to ']")]
    .filter((b) => b.className.includes("bg-[var(--color-accent)]"))
    .map((b) => b.getAttribute("aria-label"));

describe("HomeTiles phone pager columns", () => {
  it("renders fixed-width columns with a divider after the first and a trailing spacer", async () => {
    await render();
    const cols = [...track().querySelectorAll<HTMLElement>("[data-pager-column]")];
    expect(cols).toHaveLength(3);
    expect(cols.every((c) => c.className.includes("w-[min(100vw,400px)]"))).toBe(true);
    expect(cols.map((c) => c.className.includes("border-l"))).toEqual([false, true, true]);
    const spacer = track().lastElementChild as HTMLElement;
    expect(spacer.hasAttribute("data-pager-spacer")).toBe(true);
    expect(spacer.getAttribute("aria-hidden")).toBe("true");
    expect(spacer.className).toContain("w-[calc(100vw-min(100vw,400px))]");
  });

  it("takes the active list from the column width, not the track width", async () => {
    await render();
    expect(activePill()).toEqual(["Go to To Do"]);
    // One column over. By track width (951) this would still round to 0.
    await scrollTrackTo(400);
    expect(activePill()).toEqual(["Go to Monitor"]);
    // The furthest the trailing spacer lets the track go: Later is leftmost.
    await scrollTrackTo(800);
    expect(activePill()).toEqual(["Go to Later"]);
  });

  it("scrolls a pill's list to the leftmost column", async () => {
    await render();
    await act(async () => pill("Later").click());
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 800, behavior: "smooth" });
    await act(async () => pill("Monitor").click());
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 400, behavior: "smooth" });
  });

  it("broadcasts the leftmost list for the FAB", async () => {
    const seen: string[] = [];
    const onActive = (e: Event) =>
      seen.push((e as CustomEvent<{ listId: string }>).detail.listId);
    window.addEventListener("personalos:active-list", onActive);
    await render();
    await scrollTrackTo(400);
    window.removeEventListener("personalos:active-list", onActive);
    expect(seen.at(-1)).toBe("b");
  });

  it("goes to the drawer's list by column offset", async () => {
    sessionStorage.setItem("personalos:goto-list", "c");
    await render();
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 800, behavior: "smooth" });
    expect(sessionStorage.getItem("personalos:goto-list")).toBeNull();
  });
});
