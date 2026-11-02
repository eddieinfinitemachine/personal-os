// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SaveUrlBar } from "./save-url-bar";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
let container: HTMLDivElement, root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<SaveUrlBar />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("retries a lost Reader save with the same ID and starts a fresh ID for the next explicit save", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(Error("Offline")).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetcher);
  const saved = vi.fn(); window.addEventListener("personalos:capture-saved", saved);
  const input = container.querySelector("input")!;
  async function type() { await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://example.test/article");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }); }
  const save = () => act(async () => container.querySelector("button")!.click());
  await type(); await save(); expect(saved).not.toHaveBeenCalled(); await save();
  const first = fetcher.mock.calls[0][1], second = fetcher.mock.calls[1][1];
  expect(first.headers["X-Capture-ID"]).toMatch(/^[a-f0-9-]{36}$/);
  expect(first.headers["X-Capture-ID"]).toBe(second.headers["X-Capture-ID"]); expect(first.body).toBe(second.body);
  expect(saved).toHaveBeenCalledOnce(); await type(); await save();
  expect(fetcher.mock.calls[2][1].headers["X-Capture-ID"]).not.toBe(first.headers["X-Capture-ID"]);
  window.removeEventListener("personalos:capture-saved", saved);
});
