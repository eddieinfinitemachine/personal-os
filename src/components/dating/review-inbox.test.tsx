// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewInbox, type ReviewCandidate } from "./review-inbox";
import type { PickablePerson } from "./link-picker";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
const picker = vi.hoisted(() => ({ pick: null as null | ((person: PickablePerson) => void) }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("./link-picker", () => ({ LinkPicker: ({ onPick, description }: { onPick: (p: PickablePerson) => void; description: string }) => {
  picker.pick = onPick;
  return <button onClick={() => onPick({ id: "person", name: "Robin", stage: "talking" })}>{description}</button>;
} }));
const candidate: ReviewCandidate = {
  id: "candidate", name: "Robin", fingerprint: "reviewed-revision", status: "pending", identities: [], personId: null,
  draft: { name: "Robin", stage: "talking", handles: [], metAt: null },
  evidence: [
    { id: "note", source: "ecpad", title: "Journal", url: "javascript:alert(1)", occurredAt: null, quote: "Robin and I planned another date.", summary: "Plans for another date" },
    { id: "meeting", source: "granola", title: "Session", url: "https://example.com/note", occurredAt: "2026-01-02T00:00:00Z", quote: "I am excited about our next date.", summary: "Another mention" },
  ],
};
let container: HTMLDivElement;
let root: Root;
const ok = (data: unknown) => ({ ok: true, json: async () => data });
const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;
const click = async (target: HTMLElement) => act(async () => target.click());
const render = async () => act(async () => root.render(<ReviewInbox people={[{ id: "person", name: "Robin", stage: "talking" }]} />));
const response = () => ({ candidates: [candidate], excluded: [] });
async function input(target: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.refresh.mockReset();
  picker.pick = null;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("People to review", () => {
  it("shows exact evidence and unknown dates, rejects unsafe source links and explains source-only exclusions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(response())));
    await render();
    expect(container.textContent).toContain("People to review (1)");
    expect(container.textContent).toContain("Date unknown");
    expect(container.textContent).toContain("2026");
    expect(container.querySelector("blockquote")?.textContent).toBe(candidate.evidence[0].quote);
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("a")?.href).toBe("https://example.com/note");
    expect(container.textContent).toContain("applies only to this name in this source");
    for (const control of container.querySelectorAll("button, input, select, summary")) expect(control.className).toContain("min-h-11");
  });

  it("requires explicit draft submission, preserves edits through collapse and failed requests, and never invents met date", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok(response())).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Evidence changed. Review again." }) }).mockResolvedValueOnce(ok({ ok: true, personId: "new" })).mockResolvedValueOnce(ok({ candidates: [], excluded: [] }));
    vi.stubGlobal("fetch", fetch);
    await render();
    await click(button("Add person"));
    expect(fetch).toHaveBeenCalledTimes(1);
    const form = container.querySelector("form")!;
    const name = form.querySelector("input")!;
    const date = form.querySelector<HTMLInputElement>('[type="date"]')!;
    expect(date.value).toBe("");
    await input(name, "Robin W");
    await click(button("Hide draft"));
    expect(form.hidden).toBe(true);
    await click(button("Add person"));
    expect(form.querySelector("input")).toBe(name);
    expect(name.value).toBe("Robin W");
    await click(button("Save person"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Evidence changed");
    expect(name.value).toBe("Robin W");
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ action: "add", fingerprint: candidate.fingerprint, draft: { ...candidate.draft, name: "Robin W" } }));
    await click(button("Save person"));
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector("form")).toBeNull();
  });

  it("guards duplicate and stale picker callbacks and keeps the card visible until acknowledged", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockResolvedValueOnce(ok(response())).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ok({ candidates: [], excluded: [] }));
    vi.stubGlobal("fetch", fetch);
    await render();
    await click(button("Link existing"));
    const stalePick = picker.pick!;
    await act(async () => { stalePick({ id: "person", name: "Robin", stage: "talking" }); stalePick({ id: "person", name: "Robin", stage: "talking" }); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container.querySelector("h3")?.textContent).toBe("Robin");
    expect(button("Dismiss").disabled).toBe(true);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: "link", fingerprint: candidate.fingerprint, personId: "person" });
    await act(async () => pending.resolve(ok({ ok: true })));
    await act(async () => stalePick({ id: "person", name: "Robin", stage: "talking" }));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("supports exclusion and restore and preserves nearby retry errors", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok(response())).mockResolvedValueOnce(ok({ ok: true })).mockResolvedValueOnce(ok({ candidates: [], excluded: [{ ...candidate, status: "excluded" }] })).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok({ ok: true })).mockResolvedValueOnce(ok(response()));
    vi.stubGlobal("fetch", fetch);
    await render();
    await click(button("Don’t suggest again"));
    expect(container.textContent).toContain("Excluded people (1)");
    await click(button("Restore"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("offline");
    expect(button("Restore").disabled).toBe(false);
    await click(button("Restore"));
    expect(JSON.parse(fetch.mock.calls[4][1].body)).toEqual({ action: "restore", fingerprint: candidate.fingerprint });
    expect(container.textContent).toContain("People to review (1)");
  });

  it("recovers a failed inbox load without claiming it is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok(response())));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not load");
    await click(button("Refresh review"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("People to review (1)");
  });
});
