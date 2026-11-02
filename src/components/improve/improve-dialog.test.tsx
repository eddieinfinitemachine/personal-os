// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImproveDialog, POLL_MS } from "./improve-dialog";
import { OPEN_IMPROVE_EVENT, type ImprovementView } from "@/lib/improvements/request";

const item = (over: Partial<ImprovementView> = {}): ImprovementView => ({
  id: "i1",
  request: "Focus the search box when I open Home",
  context: null,
  status: "shipped",
  summary: "Home now focuses search on load.",
  reviewReason: null,
  prUrl: null,
  previewUrl: null,
  error: null,
  createdAt: "2026-11-01T12:00:00.000Z",
  completedAt: "2026-11-01T12:20:00.000Z",
  ...over,
});
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
type Reply = ReturnType<typeof response> | Promise<ReturnType<typeof response>>;

/** Routes fetch by "METHOD url"; each route may be a value or a function of the request init. */
function stubFetch(routes: Record<string, Reply | ((init?: RequestInit) => Reply)>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const route = routes[`${init?.method ?? "GET"} ${url}`];
    if (!route) throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
    return typeof route === "function" ? route(init) : route;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const calls = (fn: ReturnType<typeof stubFetch>, key: string) =>
  fn.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${url}` === key);

let container: HTMLDivElement, root: Root, visibility: DocumentVisibilityState;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = () => act(async () => root.render(<ImproveDialog />));
const open = () => act(async () => { window.dispatchEvent(new CustomEvent(OPEN_IMPROVE_EVENT)); });
const dialog = () => container.querySelector('[role="dialog"]');
const textarea = () => container.querySelector("textarea")!;
const row = (id: string) => container.querySelector(`[data-improvement="${id}"]`)!;
const buttonIn = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), value);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function exitAnimation() {
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

describe("improve dialog", () => {
  it("renders nothing until the open event, then focuses the composer and lists recent requests", async () => {
    const fetch = stubFetch({
      "GET /api/improvements": response({
        improvements: [
          item(),
          item({ id: "i2", status: "needs_review", summary: "Added due dates.", reviewReason: "Touches the Board query.", prUrl: "https://github.example.invalid/pr/7", previewUrl: "https://preview.example.invalid" }),
          item({ id: "i3", status: "failed", summary: null, error: "Typecheck failed in board.tsx" }),
          item({ id: "i4", status: "running", summary: null, completedAt: null }),
          item({ id: "i5", status: "approved", summary: null, completedAt: null }),
          item({ id: "i6", status: "queued", summary: null, completedAt: null }),
        ],
      }),
    });
    await render();
    expect(container.innerHTML).toBe("");
    expect(fetch).not.toHaveBeenCalled();

    await open();
    const d = dialog()!;
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(d.getAttribute("aria-labelledby")!)!.textContent).toBe("Improve Personal OS");
    expect(document.activeElement).toBe(textarea());
    expect(textarea().placeholder).toBe("What should change? For example:\n• Focus the search box when I open Home\n• Show due dates on Board cards");
    expect(d.textContent).toContain("An agent on your Mac implements it, tests it and ships it, then reports back below.");
    expect(buttonIn(d, "Send").disabled).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/api/improvements", { cache: "no-store" });

    expect(row("i1").textContent).toContain("Shipped");
    expect(row("i1").textContent).toContain("Home now focuses search on load.");
    expect(row("i1").querySelector("button")).toBeNull();

    const review = row("i2");
    expect(review.textContent).toContain("Needs review");
    expect(review.textContent).toContain("Touches the Board query.");
    const pr = [...review.querySelectorAll("a")].find((a) => a.textContent === "PR")!;
    expect(pr.href).toBe("https://github.example.invalid/pr/7");
    expect(pr.target).toBe("_blank");
    expect(pr.rel).toBe("noreferrer");
    expect([...review.querySelectorAll("a")].find((a) => a.textContent === "Preview")!.href).toBe("https://preview.example.invalid/");
    expect(buttonIn(review, "Ship it")).toBeTruthy();

    expect(row("i3").textContent).toContain("Failed");
    expect(row("i3").querySelector("details")!.textContent).toContain("What went wrong");
    expect(row("i3").querySelector("details")!.textContent).toContain("Typecheck failed in board.tsx");
    expect(row("i4").textContent).toContain("Working");
    expect(row("i4").querySelector(".animate-spin")).not.toBeNull();
    expect(row("i5").textContent).toContain("Shipping");
    expect(row("i6").textContent).toContain("Queued");
    expect(buttonIn(row("i6"), "Cancel")).toBeTruthy();
  });

  it("shows at most 10 recent requests", async () => {
    stubFetch({ "GET /api/improvements": response({ improvements: Array.from({ length: 14 }, (_, n) => item({ id: `i${n}` })) }) });
    await render();
    await open();
    expect(container.querySelectorAll("[data-improvement]")).toHaveLength(10);
  });

  it("closes on Escape, the Cancel button, the X and a backdrop click", async () => {
    stubFetch({ "GET /api/improvements": response({ improvements: [] }) });
    await render();
    const closers: Array<() => void> = [
      () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
      () => buttonIn(dialog()!, "Cancel").click(),
      () => (container.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click(),
      () => (container.querySelector('[data-overlay="backdrop"]') as HTMLElement).click(),
    ];
    for (const close of closers) {
      await open();
      expect(dialog()).not.toBeNull();
      expect(container.textContent).toContain("No requests yet.");
      await act(async () => close());
      expect(dialog()!.getAttribute("data-state")).toBe("closed");
      await exitAnimation();
      expect(dialog()).toBeNull();
    }
    // A click inside the dialog doesn't close it.
    await open();
    await act(async () => (dialog() as HTMLElement).click());
    await exitAnimation();
    expect(dialog()).not.toBeNull();
  });

  it("sends with ⌘↵ and the page context, optimistically, then polls while the request is in flight", async () => {
    window.history.pushState({}, "", "/board");
    document.title = "Board";
    const saved = item({ id: "i9", request: "Show due dates on Board cards", status: "queued", summary: null, completedAt: null });
    let list: ImprovementView[] = [];
    let finishPost: (value: ReturnType<typeof response>) => void = () => {};
    const fetch = stubFetch({
      "GET /api/improvements": () => response({ improvements: list }),
      "POST /api/improvements": () => new Promise((resolve) => { finishPost = resolve; }),
    });
    await render();
    await open();
    await type("  Show due dates on Board cards ");
    await act(async () => {
      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    });

    const [, init] = calls(fetch, "POST /api/improvements")[0];
    expect(JSON.parse(init!.body as string)).toEqual({
      request: "Show due dates on Board cards",
      context: {
        path: "/board",
        title: "Board",
        viewport: { width: window.innerWidth, height: window.innerHeight },
        version: null,
        userAgent: navigator.userAgent,
      },
    });
    // Optimistic row, composer cleared, no Cancel until the server has it.
    const temp = container.querySelector('[data-improvement^="temp-"]')!;
    expect(temp.textContent).toContain("Show due dates on Board cards");
    expect(temp.textContent).toContain("Queued");
    expect(buttonIn(temp, "Cancel")).toBeUndefined();
    expect(textarea().value).toBe("");

    await act(async () => finishPost(response({ improvement: saved })));
    expect(container.querySelector('[data-improvement^="temp-"]')).toBeNull();
    expect(row("i9").textContent).toContain("Queued");
    expect(calls(fetch, "GET /api/improvements")).toHaveLength(1);

    // Hidden tab: the tick is skipped.
    visibility = "hidden";
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(calls(fetch, "GET /api/improvements")).toHaveLength(1);

    visibility = "visible";
    list = [{ ...saved, status: "running" }];
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(calls(fetch, "GET /api/improvements")).toHaveLength(2);
    expect(row("i9").textContent).toContain("Working");

    list = [{ ...saved, status: "shipped", summary: "Board cards show due dates.", completedAt: "2026-11-02T12:10:00.000Z" }];
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(row("i9").textContent).toContain("Shipped");
    expect(row("i9").textContent).toContain("Board cards show due dates.");

    // Nothing in flight any more: polling stops.
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
    expect(calls(fetch, "GET /api/improvements")).toHaveLength(3);
  });

  it("stops polling when closed", async () => {
    const fetch = stubFetch({ "GET /api/improvements": response({ improvements: [item({ status: "running" })] }) });
    await render();
    await open();
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(calls(fetch, "GET /api/improvements")).toHaveLength(2);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
    expect(calls(fetch, "GET /api/improvements")).toHaveLength(2);
  });

  it("restores the text and shows the server's error when sending fails", async () => {
    stubFetch({
      "GET /api/improvements": response({ improvements: [] }),
      "POST /api/improvements": response({ error: "Improvements aren't enabled for this account." }, 403),
    });
    await render();
    await open();
    await type("Tidy the footer");
    await act(async () => buttonIn(dialog()!, "Send").click());
    expect(container.querySelector("[data-improvement]")).toBeNull();
    expect(textarea().value).toBe("Tidy the footer");
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Improvements aren't enabled for this account.");
  });

  it("ships a request waiting for review and shows a refusal inline", async () => {
    const review = item({ id: "i2", status: "needs_review", reviewReason: "Touches auth." });
    const other = item({ id: "i3", status: "needs_review", reviewReason: "Touches the schema." });
    const fetch = stubFetch({
      "GET /api/improvements": response({ improvements: [review, other] }),
      "PATCH /api/improvements/i2": response({ improvement: { ...review, status: "approved" } }),
      "PATCH /api/improvements/i3": response({ error: "Only requests waiting for review can be shipped." }, 409),
    });
    await render();
    await open();
    await act(async () => buttonIn(row("i2"), "Ship it").click());
    expect(JSON.parse(calls(fetch, "PATCH /api/improvements/i2")[0][1]!.body as string)).toEqual({ action: "approve" });
    expect(row("i2").textContent).toContain("Shipping");
    expect(buttonIn(row("i2"), "Ship it")).toBeUndefined();

    await act(async () => buttonIn(row("i3"), "Ship it").click());
    expect(row("i3").querySelector('[role="alert"]')!.textContent).toBe("Only requests waiting for review can be shipped.");
    // The 409 refreshes the list to show where it actually is.
    expect(calls(fetch, "GET /api/improvements")).toHaveLength(2);
  });

  it("cancels a queued request, and explains when the worker already took it", async () => {
    const fetch = stubFetch({
      "GET /api/improvements": response({ improvements: [item({ id: "i6", status: "queued" }), item({ id: "i7", status: "queued" })] }),
      "DELETE /api/improvements/i6": response({ ok: true }),
      "DELETE /api/improvements/i7": response({ error: "Only queued requests can be cancelled." }, 409),
    });
    await render();
    await open();
    await act(async () => buttonIn(row("i6"), "Cancel").click());
    expect(calls(fetch, "DELETE /api/improvements/i6")).toHaveLength(1);
    expect(container.querySelector('[data-improvement="i6"]')).toBeNull();

    await act(async () => buttonIn(row("i7"), "Cancel").click());
    expect(row("i7").querySelector('[role="alert"]')!.textContent).toBe("Only queued requests can be cancelled.");
  });
});
