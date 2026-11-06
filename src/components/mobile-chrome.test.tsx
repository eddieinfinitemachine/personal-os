// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("./sidebar-template-picker", () => ({
  useEnabledTemplates: () => ({ enabled: [], available: [], add: () => {}, reorder: () => {} }),
  AddTemplateButton: () => null,
}));
vi.mock("./mobile-fab", () => ({ MobileFab: () => null }));
vi.mock("./theme-toggle", () => ({ ThemeToggle: () => null }));

import { MobileChromeProvider } from "./mobile-chrome";

// A screen whose width can change, like an iPhone Duo folding and unfolding:
// `(min-width: Npx)` queries answer from `width` and hear "change" events.
let width = 382;
const listeners = new Map<string, Set<(e: MediaQueryListEvent) => void>>();
const stubScreen = () =>
  vi.stubGlobal("matchMedia", (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const set = listeners.get(q) ?? new Set();
    listeners.set(q, set);
    return {
      get matches() {
        return min ? width >= Number(min[1]) : false;
      },
      media: q,
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => set.add(fn),
      removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => set.delete(fn),
    };
  });
const resize = (w: number) =>
  act(async () => {
    width = w;
    for (const [q, set] of listeners) {
      const min = /min-width:\s*(\d+)px/.exec(q);
      const matches = min ? w >= Number(min[1]) : false;
      for (const fn of set) fn({ matches, media: q } as MediaQueryListEvent);
    }
  });

let container: HTMLDivElement, root: Root;
const scrollTo = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  width = 382;
  listeners.clear();
  stubScreen();
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  scrollTo.mockClear();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  Object.defineProperty(window, "scrollY", { value: 600, configurable: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(<MobileChromeProvider>{null}</MobileChromeProvider>));
const drawer = () => container.querySelector("aside[role=dialog]") as HTMLElement;
const isOpen = () => drawer().className.includes("translate-x-0");
const openDrawer = () =>
  act(async () => {
    (container.querySelector("[aria-label='Open menu']") as HTMLButtonElement).click();
  });

describe("MobileDrawer", () => {
  it("closes when the screen widens to the desktop layout (unfolding)", async () => {
    await render();
    await openDrawer();
    expect(isOpen()).toBe(true);

    await resize(951);
    expect(isOpen()).toBe(false);

    // Folding back must not bring it back: it was closed, not merely hidden.
    await resize(382);
    expect(isOpen()).toBe(false);
  });

  it("pins the page while open and puts it back where it was on close", async () => {
    await render();
    await openDrawer();
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-600px");

    await act(async () => {
      (container.querySelector("[aria-label='Close menu']") as HTMLButtonElement).click();
    });
    expect(document.body.style.position).toBe("");
    expect(document.body.style.top).toBe("");
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, behavior: "instant" });
  });
});
