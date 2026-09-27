// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatingHome, type DatingCard, type GranolaSuggestion } from "./dating-home";
import type { PickablePerson } from "./link-picker";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
const picker = vi.hoisted(() => ({ pick: null as null | ((person: PickablePerson) => void) }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("./people-board", () => ({ PeopleBoard: () => null }));
vi.mock("./dictate-card", () => ({ DictateCard: () => <div data-testid="dictate">Dictate a note</div> }));
vi.mock("./quick-add", () => ({ QuickAdd: () => <div role="dialog">New person form</div> }));
vi.mock("./link-picker", () => ({ LinkPicker: ({ onPick }: { onPick: (p: PickablePerson) => void }) => {
  picker.pick = onPick;
  return <button onClick={() => onPick({ id: "chosen", name: "Margaux", stage: "ended" })}>Choose matching person</button>;
} }));

const person: DatingCard = {
  id: "chosen", name: "Margaux", lessons: null, stage: "ended", handles: [], instagram: null,
  metVia: null, metAt: null, endedAt: null, age: null, city: null, work: null, remember: [],
  greenFlags: [], redFlags: [], notes: null, insights: null, insightsAt: null, lastMessageAt: null,
  createdAt: "2026-01-01T00:00:00Z", dateCount: 0, avgVibe: null, avatarUrl: null,
  firstEventAt: null, lastEventAt: null, lastDate: null,
};
const suggestions: GranolaSuggestion[] = [
  { id: "old", name: "Margo", summary: "Earlier relationship", title: "Therapy", url: null, occurredAt: "2025-03-22T12:00:00Z" },
  { id: "new", name: "Margo", summary: "Later relationship", title: "Therapy", url: null, occurredAt: "2026-01-15T12:00:00Z" },
];
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.refresh.mockReset();
  navigation.push.mockReset();
  picker.pick = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = async (granola = false) => act(async () => root.render(<DatingHome people={[person]} suggestions={suggestions} granola={granola} />));
const review = () => container.querySelector('section[aria-label="Review from Granola"]')!;
const count = (n: number) => expect(review().querySelector("h2")?.textContent).toMatch(new RegExp(`\\(${n}\\)`));
const row = (summary = "Earlier relationship") => [...review().querySelectorAll("li")].find((item) => item.textContent?.includes(summary))!;
const button = (label: string, scope: ParentNode = container) => [...scope.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)!;
const click = async (target: HTMLElement) => act(async () => target.click());
const ok = (data: unknown = {}) => ({ ok: true, json: async () => data });
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function takeAction(action: "add" | "dismiss" | "link") {
  if (action === "link") {
    await click(button("Add to…", row()));
    await click(button("Choose matching person"));
  } else await click(button(action === "add" ? "Add her" : "Dismiss", row()));
}

describe("Granola suggestion review", () => {
  it("shows years and a visible pending count, restoring only the selected note after linking fails", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    await render();
    count(2);
    expect(review().textContent).toContain("2025");
    expect(review().textContent).toContain("2026");
    await takeAction("link");
    expect(fetch).toHaveBeenCalledWith("/api/dating/suggestions/old/link", expect.objectContaining({ body: JSON.stringify({ personId: "chosen" }) }));
    expect(review().textContent).not.toContain("Earlier relationship");
    expect(review().textContent).toContain("Later relationship");
    count(1);
    await act(async () => pending.resolve({ ok: false, json: async () => ({ error: "Please retry" }) }));
    count(2);
    expect(review().textContent).toContain("Earlier relationship");
    expect(review().querySelector('[role="alert"]')?.textContent).toContain("Please retry");
    expect(button("Add her", row()).disabled).toBe(false);
  });

  it.each(["add", "dismiss", "link"] as const)("recovers a rejected %s request and allows a successful retry", async (action) => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok({ person: { id: "added-person" } }));
    vi.stubGlobal("fetch", fetch);
    await render();
    await takeAction(action);
    count(2);
    expect(review().querySelector('[role="alert"]')?.textContent).toMatch(/try again/i);
    expect(button("Add her", row()).disabled).toBe(false);
    expect(button("Dismiss", row()).disabled).toBe(false);
    expect(navigation.push).not.toHaveBeenCalled();
    await takeAction(action);
    count(1);
    expect(review().textContent).not.toContain("Earlier relationship");
    expect(review().textContent).toContain("Later relationship");
    expect(review().querySelector('[role="alert"]')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    if (action === "add") expect(navigation.push).toHaveBeenCalledWith("/dating/added-person");
    else expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it.each(["add", "dismiss"] as const)("keeps server errors beside the %s controls and releases them for retry", async (action) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Not saved on server" }) }));
    await render();
    await takeAction(action);
    count(2);
    expect(review().querySelector('[role="alert"]')?.textContent).toContain("Not saved on server");
    expect(button("Add her", row()).disabled).toBe(false);
    expect(button("Dismiss", row()).disabled).toBe(false);
  });

  it.each(["add", "dismiss"] as const)("prevents repeated %s clicks before React disables the controls", async (action) => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    await render();
    const target = button(action === "add" ? "Add her" : "Dismiss", row());
    const competing = button("Dismiss", row("Later relationship"));
    await act(async () => { target.click(); target.click(); competing.click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(button("Add her", row()).disabled).toBe(true);
    await act(async () => pending.resolve(ok({ person: { id: "added-person" } })));
    count(1);
    expect(review().textContent).toContain("Later relationship");
    expect(button("Add her", row("Later relationship")).disabled).toBe(false);
  });

  it("guards duplicate and stale picker callbacks while linking and after the note was reviewed", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    await render();
    await click(button("Add to…", row()));
    const stalePick = picker.pick!;
    const otherDismiss = button("Dismiss", row("Later relationship"));
    await act(async () => { stalePick(person); stalePick(person); otherDismiss.click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    count(1);
    expect(button("Add her", row("Later relationship")).disabled).toBe(true);
    await act(async () => pending.resolve(ok()));
    await act(async () => stalePick(person));
    expect(fetch).toHaveBeenCalledTimes(1);
    count(1);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("ignores a stale picker choice when another review action is already pending", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    await render();
    await click(button("Add to…", row()));
    const stalePick = picker.pick!;
    await click(button("Dismiss", row("Later relationship")));
    await act(async () => stalePick(person));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/dating/suggestions/new/dismiss");
    await act(async () => pending.resolve(ok()));
    count(1);
    expect(review().textContent).toContain("Earlier relationship");
  });
});

describe("home actions and imports disclosure", () => {
  it("labels Add person clearly and leaves notes and review outside collapsed import controls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ remaining: 0 })));
    await render(true);
    const details = [...container.querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent === "Imports and sync")!;
    expect(details).toBeDefined();
    expect(details.open).toBe(false);
    expect(details.contains(review())).toBe(false);
    expect(details.contains(container.querySelector('[data-testid="dictate"]'))).toBe(false);
    expect(details.contains(button("Sync now"))).toBe(true);
    expect(details.contains(button("Sync iMessage and WhatsApp from your Mac"))).toBe(true);
    await click(button("Add person"));
    expect(container.querySelector('[role="dialog"]')?.textContent).toBe("New person form");
  });

  it("keeps an in-progress import mounted across collapse and does not start another request when toggled", async () => {
    const pending = deferred();
    const fetch = vi.fn((url: string) => url === "/api/dating/organize-all" ? Promise.resolve(ok({ remaining: 0 })) : pending.promise);
    vi.stubGlobal("fetch", fetch);
    await render(true);
    const details = [...container.querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent === "Imports and sync")!;
    const summary = details.querySelector("summary")!;
    expect(fetch).toHaveBeenCalledTimes(1); // read-only count on mount
    await click(summary);
    expect(details.open).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    await click(button("Import since…", details));
    const date = details.querySelector<HTMLInputElement>('[aria-label="Import meetings since"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(date, "2025-01-01");
      date.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Import", details));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(button("Import", details).disabled).toBe(true);
    await click(summary);
    expect(details.open).toBe(false);
    await click(summary);
    expect(details.querySelector('[aria-label="Import meetings since"]')).toBe(date);
    expect(date.value).toBe("2025-01-01");
    expect(button("Import", details).disabled).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(ok({ processed: 2, filed: 2, suggestions: 0, remaining: 0, errors: [], nextSince: "2026-01-01", nextAfterId: null })));
    expect(details.querySelector('[role="status"]')?.textContent).toContain("2 filed");
    expect(details.querySelector('[role="status"]')?.textContent).toContain("done");
    expect(button("Sync now", details).disabled).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
