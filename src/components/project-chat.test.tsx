// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ProjectChat } from "./project-chat";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no element scrolling; the chat scrolls to its newest turn.
  Element.prototype.scrollTo = () => {};
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = () =>
  act(async () => root.render(<ProjectChat projectId="p1" projectName="Kitchen Remodel" />));
const panel = () => container.querySelector("form")?.parentElement ?? null;
const toggle = () => container.querySelector("button[title]") as HTMLButtonElement;
const open = () => act(async () => toggle().click());

describe("ProjectChat", () => {
  it("closes from the panel's Close button (the panel covers the toggle on a phone)", async () => {
    await render();
    await open();
    expect(panel()).not.toBeNull();
    // The full-screen panel would hide the toggle below md, so it steps aside.
    expect(toggle().className).toContain("max-md:hidden");

    const close = container.querySelector("button[aria-label='Close']") as HTMLButtonElement;
    expect(close).not.toBeNull();
    await act(async () => close.click());
    expect(panel()).toBeNull();
    expect(toggle().className).not.toContain("max-md:hidden");
  });

  it("closes on Escape", async () => {
    await render();
    await open();
    expect(panel()).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(panel()).toBeNull();
  });
});
