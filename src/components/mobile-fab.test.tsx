// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => nav.pathname }));
vi.mock("@/lib/haptic", () => ({ haptic: vi.fn() }));
import { MobileFab } from "./mobile-fab";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("MobileFab", () => {
  it("shows on the home page and stays off the workout page", async () => {
    nav.pathname = "/";
    await act(async () => root.render(<MobileFab />));
    expect(container.querySelector("button")).not.toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    for (const path of ["/workout", "/workout/history"]) {
      nav.pathname = path;
      await act(async () => root.render(<MobileFab />));
      expect(container.querySelector("button")).toBeNull();
    }
  });
});
