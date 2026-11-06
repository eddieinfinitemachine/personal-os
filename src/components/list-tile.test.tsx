// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ListTile } from "./list-tile";
import { DESKTOP_QUERY, FINE_POINTER_QUERY } from "@/lib/touch";

let container: HTMLDivElement, root: Root;
// Answers matchMedia as a screen of `width` px with (or without) a
// mouse/trackpad, so width queries still match the way a browser would.
const stubScreen = (width: number, fine: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches =
      q === FINE_POINTER_QUERY
        ? fine
        : q === DESKTOP_QUERY
          ? (width >= 768 && fine) || width >= 1024
          : min
            ? width >= Number(min[1])
            : max
              ? width <= Number(max[1])
              : false;
    return { matches, media: q, addEventListener: () => {}, removeEventListener: () => {} };
  });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({}))));
  // The tile renders a phone and a desktop composer, both autoFocus; CSS hides
  // one in a browser, but jsdom focuses both and the blur closes the first.
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const list = { id: "list-1", name: "Errands", color: "blue", isDefault: false };
const render = () =>
  act(async () => root.render(<ListTile list={list} todos={[]} totalCount={0} />));
const composers = () => container.querySelectorAll('input[placeholder="New Reminder"]').length;
const tapTile = () =>
  act(async () => {
    container.querySelector("[data-droptarget-list]")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
  });

describe("ListTile tap to compose", () => {
  it("opens the composer on a tap when there is no fine pointer, even at a desktop width", async () => {
    // The unfolded iPhone Duo: 951px wide, touch only, no ⌘N.
    stubScreen(951, false);
    await render();
    expect(composers()).toBe(0);
    await tapTile();
    expect(composers()).toBeGreaterThan(0);
  });

  it("does nothing on a click with a mouse or trackpad (⌘N composes there)", async () => {
    stubScreen(1440, true);
    await render();
    await tapTile();
    expect(composers()).toBe(0);
  });
});
