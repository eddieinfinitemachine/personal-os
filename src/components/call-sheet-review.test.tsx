// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallSheetReview } from "./call-sheet-review";
import type { CallSheetReviewPerson } from "@/lib/call-sheet/types";
function person(name: string, extra: Partial<CallSheetReviewPerson> = {}): CallSheetReviewPerson {
  return { personId: name.toLowerCase(), name, imageUrl: null, company: null, role: null, city: null, howWeMet: null, strength: null, circles: [], tags: [], summary: null, reachable: true, ...extra };
}
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
const review = (...names: string[]) => response({ total: names.length, people: names.map(name => person(name)) });
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const render = (count = 3, onClose = vi.fn(), onChanged = vi.fn()) => act(async () => root.render(<CallSheetReview count={count} onClose={onClose} onChanged={onChanged} />));
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
const posts = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(c => c[1]?.method === "POST").map(c => JSON.parse(c[1].body));
const current = () => container.querySelector("[data-person-id]")?.getAttribute("data-person-id");
function deferred() { let resolve!: (v: unknown) => void, reject!: (e: unknown) => void; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
describe("call sheet quick review", () => {
  it("shows one person with their context and no dialer links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ total: 2, people: [person("Avery", { company: "Acme", role: "CTO", city: "Austin", howWeMet: "College", strength: "3 - friend", circles: ["friends"], tags: ["climbing"], summary: "Runs a robotics startup.", reachable: false }), person("Blake")] })));
    await render(2);
    const text = container.querySelector('[role="dialog"]')!.textContent!;
    expect(text).toContain("Quick review"); expect(text).toContain("1 of 2"); expect(text).toContain("Acme · CTO · Austin"); expect(text).toContain("College");
    expect(text).toContain("3 - friend"); expect(text).toContain("friends · climbing"); expect(text).toContain("Runs a robotics startup."); expect(text).toContain("No phone or email on file");
    expect(container.textContent).not.toContain("Blake");
    expect(container.querySelector('a[href^="tel:"], a[href^="sms:"], a[href^="mailto:"]')).toBeNull();
  });
  it("advances at once and sends each choice strictly in order", async () => {
    const first = deferred();
    const fetch = vi.fn().mockResolvedValueOnce(review("A", "B", "C", "D", "E", "F", "G")).mockImplementationOnce(() => first.promise).mockResolvedValue(response({ ok: true }));
    vi.stubGlobal("fetch", fetch); await render(7);
    expect(fetch.mock.calls[0][0]).toBe("/api/call-sheet/review");
    await press("1");
    expect(current()).toBe("b"); expect(container.textContent).toContain("2 of 7");
    await press("x");
    expect(current()).toBe("c");
    expect(posts(fetch)).toEqual([{ personId: "a", decision: "keep", cadenceDays: 30 }]);
    await act(async () => first.resolve(response({ ok: true })));
    await press("2"); await press("3"); await press("4"); await press("S"); await press("ArrowRight");
    expect(posts(fetch)).toEqual([
      { personId: "a", decision: "keep", cadenceDays: 30 },
      { personId: "b", decision: "hide" },
      { personId: "c", decision: "keep", cadenceDays: 90 },
      { personId: "d", decision: "keep", cadenceDays: 180 },
      { personId: "e", decision: "keep", cadenceDays: 365 },
    ]);
    expect(container.textContent).toContain("All caught up.");
  });
  it("puts a failed person back in front, drops later unsent choices, and waits for the next action", async () => {
    const first = deferred();
    const fetch = vi.fn().mockResolvedValueOnce(review("A", "B", "C")).mockImplementationOnce(() => first.promise).mockResolvedValue(response({ ok: true }));
    vi.stubGlobal("fetch", fetch); await render();
    await press("1"); await press("2");
    expect(current()).toBe("c");
    await act(async () => first.resolve(response({ error: "Person not found" }, 404)));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Person not found");
    expect(current()).toBe("a"); expect(container.textContent).toContain("1 of 3");
    expect(posts(fetch)).toEqual([{ personId: "a", decision: "keep", cadenceDays: 30 }]);
    await press("x");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(current()).toBe("b");
    expect(posts(fetch).at(-1)).toEqual({ personId: "a", decision: "hide" });
  });
  it("Undo resets a saved choice and steps back over a skip without saving", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(review("A", "B", "C")).mockResolvedValue(response({ ok: true }));
    vi.stubGlobal("fetch", fetch); await render();
    await press("1"); await press("s");
    expect(current()).toBe("c");
    await press("z");
    expect(current()).toBe("b"); expect(posts(fetch)).toHaveLength(1);
    await press("Z");
    expect(current()).toBe("a");
    expect(posts(fetch)).toEqual([{ personId: "a", decision: "keep", cadenceDays: 30 }, { personId: "a", decision: "reset" }]);
    await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent?.includes("Don’t suggest"))!.click());
    expect(posts(fetch).at(-1)).toEqual({ personId: "a", decision: "hide" });
  });
  it("ignores typing in fields, key repeats and modified keys", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(review("A", "B")).mockResolvedValue(response({ ok: true }));
    vi.stubGlobal("fetch", fetch); await render(2);
    const input = document.createElement("input"); container.querySelector('[role="dialog"]')!.append(input);
    await press("1", {}, input);
    await press("1", { repeat: true }); await press("x", { metaKey: true }); await press("s", { ctrlKey: true }); await press("z", { altKey: true });
    expect(current()).toBe("a"); expect(posts(fetch)).toEqual([]);
  });
  it("finishes with All caught up and refreshes the sheet only after its saves land", async () => {
    const save = deferred();
    const fetch = vi.fn().mockResolvedValueOnce(review("A")).mockImplementationOnce(() => save.promise);
    const onClose = vi.fn(), onChanged = vi.fn();
    vi.stubGlobal("fetch", fetch); await render(1, onClose, onChanged);
    await press("4");
    expect(container.textContent).toContain("All caught up.");
    await act(async () => (container.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledOnce(); expect(onChanged).not.toHaveBeenCalled();
    await act(async () => save.resolve(response({ ok: true })));
    expect(onChanged).toHaveBeenCalledOnce();
  });
  it("closing without a decision does not refresh; an empty queue is caught up", async () => {
    const onClose = vi.fn(), onChanged = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(review())); await render(0, onClose, onChanged);
    expect(container.textContent).toContain("All caught up.");
    await act(async () => (container.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledOnce(); expect(onChanged).not.toHaveBeenCalled();
  });
  it("shows loading, then a load failure with retry", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(review("A"));
    vi.stubGlobal("fetch", fetch); await render(5);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Getting 5 people to review");
    await act(async () => pending.resolve(response({}, 500)));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not load");
    await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Retry")!.click());
    expect(current()).toBe("a");
  });
});
