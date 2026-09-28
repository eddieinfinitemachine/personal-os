// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatingSourcesProvider, SourceSettings, SourceStatus, type DatingSource } from "./source-status";

const source: DatingSource = { id: "texts", source: "texts", enabled: true, status: "needs_attention", lastSuccessAt: "2026-01-01T12:00:00Z", lastAttemptAt: "2026-01-02T12:00:00Z", lastNewDataAt: null, backlog: 3, coverageStart: "2025-12-01T00:00:00Z", coverageEnd: "2025-12-31T00:00:00Z", error: "Mac needs to retry" };
let container: HTMLDivElement;
let root: Root;
const ok = (data: unknown) => ({ ok: true, json: async () => data });
const response = (sources: DatingSource[] = []) => ({ sources, granolaAvailable: false });
const button = (label: string, scope: ParentNode = container) => [...scope.querySelectorAll("button")].find((item) => item.textContent === label)!;
const click = async (target: HTMLElement) => act(async () => target.click());
const render = async () => act(async () => root.render(<DatingSourcesProvider><SourceStatus /><SourceSettings /></DatingSourcesProvider>));
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("dating source controls", () => {
  it("keeps success, attempt, new data, coverage and remaining work distinct", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(response([source]))));
    await render();
    const status = container.querySelector('[aria-label="Source status"]')!;
    expect(status.textContent).toContain("Needs attention");
    expect(status.textContent).toContain("EC Pad · Not connected");
    expect(status.textContent).toContain("Granola · Not connected");
    expect(status.textContent).not.toContain("Up to date");
    const text = container.querySelector('[aria-label="Texts settings"]')!;
    expect(text.textContent).toContain("Last successful scan: Jan 1, 2026");
    expect(text.textContent).toContain("Last attempt: Jan 2, 2026");
    expect(text.textContent).toContain("Last new data: None yet");
    expect(text.textContent).toContain("3 items still waiting");
    expect(text.textContent).toContain("Dec 1, 2025 – Dec 31, 2025");
    for (const control of container.querySelectorAll("button, summary")) expect(control.className).toContain("min-h-11");
  });

  it("requires explicit message discovery opt-in and blocks duplicate changes", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockResolvedValueOnce(ok(response())).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ok(response([{ ...source, error: null, status: "waiting_for_mac" }])));
    vi.stubGlobal("fetch", fetch);
    await render();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("last 30 days of one-to-one iMessage and WhatsApp");
    const enable = button("Enable message discovery");
    await act(async () => { enable.click(); enable.click(); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: "enable", source: "texts" });
    expect(enable.disabled).toBe(true);
    await act(async () => pending.resolve(ok({ ok: true })));
    expect(button("Pause")).toBeDefined();
  });

  it("keeps pairing code mounted through collapse and hides it when expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const fetch = vi.fn().mockResolvedValueOnce(ok(response())).mockResolvedValueOnce(ok({ code: "synthetic-code", expiresAt: "2026-01-01T00:10:00Z" })).mockResolvedValueOnce(ok(response()));
    vi.stubGlobal("fetch", fetch);
    await render();
    const details = container.querySelector("details")!;
    await click(details.querySelector("summary")!);
    await click(button("Pair EC Pad"));
    const code = container.querySelector("code")!;
    expect(code.textContent).toBe("synthetic-code");
    expect(container.textContent).toContain("Expires");
    await click(details.querySelector("summary")!);
    await click(details.querySelector("summary")!);
    expect(container.querySelector("code")).toBe(code);
    expect(fetch).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTime(10 * 60 * 1000));
    expect(container.querySelector("code")).toBeNull();
    expect(container.textContent).toContain("pairing code expired");
  });

  it("separates removal from pause and requires a second explicit removal click", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok(response([source]))).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Could not remove now" }) }).mockResolvedValueOnce(ok({ ok: true })).mockResolvedValueOnce(ok(response([source])));
    vi.stubGlobal("fetch", fetch);
    await render();
    await click(button("Remove imported evidence…"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Your profiles and manual edits stay");
    await click(button("Remove evidence from Texts"));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Could not remove now");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: "remove", source: "texts", id: "texts" });
    await click(button("Remove evidence from Texts"));
    expect(button("Remove evidence from Texts").parentElement?.parentElement?.hidden).toBe(true);
  });

  it("shows unavailable health after a failed load and retries before enabling changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok(response())));
    await render();
    expect(container.querySelector('[aria-label="Source status"]')?.textContent).toContain("Status unavailable");
    expect(button("Enable message discovery").disabled).toBe(true);
    await click(button("Refresh source status"));
    expect(button("Enable message discovery").disabled).toBe(false);
  });
});
