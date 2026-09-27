// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDatingInsightsPoll } from "./use-dating-insights-poll";

let root: Root;
let container: HTMLDivElement;
let visibility: "visible" | "hidden";
const update = vi.fn();
function Harness({ at = null, has = false, paused = false }: { at?: string | null; has?: boolean; paused?: boolean }) {
  useDatingInsightsPoll({ personId: "p", insightsAt: at, hasInsights: has, paused, onUpdate: update });
  return null;
}
const reply = (at: string, text = "Saved summary") => ({ ok: true, json: async () => ({ insights: { summary: text }, insightsAt: at }) });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  update.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("saved summary polling", () => {
  it("reads after10s without a summary, then slows to30s and never posts", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply("2026-09-27T10:00:00Z"));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(update).toHaveBeenCalledWith({ insights: { summary: "Saved summary" }, insightsAt: "2026-09-27T10:00:00Z" });
    expect(fetcher).toHaveBeenCalledWith("/api/dating/p/insights", expect.objectContaining({ method: "GET", cache: "no-store" }));
    await act(async () => vi.advanceTimersByTimeAsync(29_000));
    expect(fetcher).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledOnce(); // unchanged timestamp is ignored
  });
  it("stops reads while hidden and checks saved results when visible again", async () => {
    visibility = "hidden";
    const fetcher = vi.fn().mockResolvedValue(reply("2026-09-27T10:00:00Z"));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetcher).not.toHaveBeenCalled();
    visibility = "visible";
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not overwrite a newer manual result with a delayed read", async () => {
    let finish!: (value: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    await act(async () => root.render(<Harness at="2026-09-27T12:00:00Z" has />));
    await act(async () => finish(reply("2026-09-27T11:00:00Z", "Old response")));
    expect(update).not.toHaveBeenCalled();
  });
  it("aborts an outstanding poll while manual generation is running", async () => {
    let signal!: AbortSignal;
    let finish!: (value: unknown) => void;
    const fetcher = vi.fn((_url, options) => { signal = options.signal; return new Promise((resolve) => { finish = resolve; }); });
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    await act(async () => root.render(<Harness paused />));
    expect(signal.aborted).toBe(true);
    await act(async () => finish(reply("2026-09-27T11:00:00Z")));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });
});
