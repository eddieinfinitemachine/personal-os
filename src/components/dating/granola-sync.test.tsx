// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GranolaSync } from "./granola-sync";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
let container: HTMLDivElement;
let root: Root;
const time = "2026-09-26T12:00:00Z";
const batch = { processed: 1, filed: 1, suggestions: 0, remaining: 1, errors: [], nextSince: time, nextAfterId: "a" };
const response = (data: unknown) => ({ ok: true, json: async () => data });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it("continues through equal timestamps using the returned meeting id", async () => {
  const post = vi.fn()
    .mockResolvedValueOnce(response(batch))
    .mockResolvedValueOnce(response({ ...batch, nextAfterId: "b" }))
    .mockResolvedValueOnce(response({ ...batch, nextAfterId: "c", remaining: 0 }));
  vi.stubGlobal("fetch", (url: string, opts?: RequestInit) => url.endsWith("organize-all")
    ? Promise.resolve(response({ remaining: 0 })) : post(url, opts));
  await act(async () => root.render(<GranolaSync />));
  await click("Sync now");
  expect(post).toHaveBeenCalledTimes(3);
  expect(JSON.parse(post.mock.calls[1][1].body)).toEqual({ since: time, afterId: "a" });
  expect(JSON.parse(post.mock.calls[2][1].body)).toEqual({ since: time, afterId: "b" });
  expect(container.textContent).toContain("3 of 3 checked");
});

it("stops at a failed historical note and retries from the retained cursor", async () => {
  const post = vi.fn()
    .mockResolvedValueOnce(response({ ...batch, errors: [{ meetingId: "b", title: "Therapy", error: "Try later" }] }))
    .mockResolvedValueOnce(response({ ...batch, nextAfterId: "b", remaining: 0 }));
  vi.stubGlobal("fetch", (url: string, opts?: RequestInit) => url.endsWith("organize-all")
    ? Promise.resolve(response({ remaining: 0 })) : post(url, opts));
  await act(async () => root.render(<GranolaSync />));
  await click("Sync now");
  expect(post).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Therapy: Try later");
  expect(container.textContent).not.toContain("· done");
  await click("Retry");
  expect(JSON.parse(post.mock.calls[1][1].body)).toEqual({ since: time, afterId: "a" });
  expect(container.textContent).toContain("· done");
});


it("preserves the cursor when stopped and continues without claiming completion", async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  const pending = new Promise<ReturnType<typeof response>>((resolve) => { finish = resolve; });
  const post = vi.fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(response({ ...batch, nextAfterId: "b", remaining: 0 }));
  vi.stubGlobal("fetch", (url: string, opts?: RequestInit) => url.endsWith("organize-all")
    ? Promise.resolve(response({ remaining: 0 })) : post(url, opts));
  await act(async () => root.render(<GranolaSync />));
  await click("Sync now");
  await click("Stop");
  await act(async () => { finish(response(batch)); });
  expect(container.textContent).toContain("· paused");
  expect(container.textContent).not.toContain("· done");
  await click("Continue");
  expect(JSON.parse(post.mock.calls[1][1].body)).toEqual({ since: time, afterId: "a" });
  expect(container.textContent).toContain("· done");
});

it("pauses at the batch cap while retaining the next cursor", async () => {
  let id = 0;
  const post = vi.fn(async () => response({ ...batch, nextAfterId: String(++id) }));
  vi.stubGlobal("fetch", (url: string, opts?: RequestInit) => url.endsWith("organize-all")
    ? Promise.resolve(response({ remaining: 0 })) : post());
  await act(async () => root.render(<GranolaSync />));
  await click("Sync now");
  expect(post).toHaveBeenCalledTimes(300);
  expect(container.textContent).toContain("· paused");
  expect(container.textContent).not.toContain("· done");
  expect(container.textContent).toContain("Continue");
});
