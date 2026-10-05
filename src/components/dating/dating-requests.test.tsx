// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatingPersonDTO, DatingEventDTO } from "@/lib/dating-server";
import { DatingDetail } from "./dating-detail";
import { DatingHome } from "./dating-home";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("./contact-lookup", () => ({ ContactLookup: () => null }));
vi.mock("./dictate-card", () => ({ DictateCard: () => null }));
vi.mock("./photo-strip", () => ({ PhotoStrip: () => null }));
vi.mock("./relationship-chart", () => ({ RelationshipChart: () => null }));
vi.mock("./sync-help", () => ({ SyncHelp: () => null }));
vi.mock("./review-inbox", () => ({ ReviewInbox: () => null }));
vi.mock("./source-status", () => ({
  DatingSourcesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SourceAttention: () => null,
}));
vi.mock("./people-board", () => ({ PeopleBoard: () => null }));

const person: DatingPersonDTO = {
  id: "retry-person", name: "Ana", stage: "talking", handles: [], instagram: null,
  metAt: null, metVia: null, endedAt: null, age: null, city: null, work: null,
  remember: [], greenFlags: [], redFlags: [], notes: "Our first dinner was fun", lessons: null,
  insights: null, insightsAt: null, lastMessageAt: null, createdAt: "2026-09-26T12:00:00Z",
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { fn(); return 0; });
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  push.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = (label: string, scope: ParentNode = container) => [...scope.querySelectorAll("button")]
  .find((item) => item.textContent?.trim() === label)!;
const click = async (target: HTMLElement) => act(async () => target.click());
const detail = async (events: DatingEventDTO[] = []) => act(async () => root.render(<DatingDetail initialPerson={person} initialEvents={events} initialMessages={[]} initialMore={false} meta={[]} />));
const ok = (data: unknown) => ({ ok: true, json: async () => data });

// The request failures must leave their action enabled, drafts intact, and an error visible.
describe("dating request recovery", () => {
  it("refreshes automatic contact details without replacing a contact edit being typed", async () => {
    await detail();
    const instagram = container.querySelector<HTMLInputElement>('input[placeholder="@handle or profile link"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(instagram, "@my_edit");
      instagram.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => root.render(<DatingDetail initialPerson={{ ...person, handles: ["+14155550111"], instagram: "auto_contact" }} initialEvents={[]} initialMessages={[]} initialMore={false} meta={[]} />));
    expect(container.querySelector<HTMLInputElement>('input[placeholder="(415) 555-0134"]')?.value).toBe("+14155550111");
    expect(container.querySelector<HTMLInputElement>('input[placeholder="@handle or profile link"]')?.value).toBe("@my_edit");
    expect(container.querySelector('a[aria-label="@auto_contact on Instagram"]')).not.toBeNull();
  });

  it("keeps a manually saved contact while an older background refresh arrives", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ person: { ...person, handles: ["+14155550222"] } })));
    await detail();
    const phone = container.querySelector<HTMLInputElement>('input[placeholder="(415) 555-0134"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(phone, "+14155550222");
      phone.dispatchEvent(new Event("input", { bubbles: true }));
      phone.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => root.render(<DatingDetail initialPerson={{ ...person, handles: ["+14155550111"] }} initialEvents={[]} initialMessages={[]} initialMore={false} meta={[]} />));
    expect(phone.value).toBe("+14155550222");
    // A second blur must see the retained confirmed value, not save it again.
    await act(async () => phone.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rolls the visible stage back after a save fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));
    await detail();
    const stage = container.querySelector<HTMLSelectElement>('[aria-label="Stage"]')!;
    await act(async () => {
      stage.value = "dating";
      stage.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(stage.value).toBe("talking");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
  });

  it("retries reading the thread after a rejected request", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok({ person: { ...person, insights: { summary: "Recovered summary" } } }));
    vi.stubGlobal("fetch", fetch);
    await detail();
    await click(button("Generate summary"));
    expect(button("Generate summary").disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not read");
    await click(button("Generate summary"));
    expect(container.textContent).toContain("Recovered summary");
  });

  it("retries organizing after a rejected request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok({ result: { summary: "One date" }, person, events: [] })));
    await detail();
    await click(button("Organize notes"));
    expect(button("Organize notes").disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not organize");
    await click(button("Organize notes"));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("One date");
  });

  it("keeps the detail page after failed deletion and permits retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok({ ok: true })));
    await detail();
    await click(button("Delete Ana"));
    expect(push).not.toHaveBeenCalled();
    expect(button("Delete Ana").disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not delete");
    await click(button("Delete Ana"));
    expect(push).toHaveBeenCalledWith("/dating");
  });

  it("keeps an unsaved timeline draft after a network failure", async () => {
    const event = { id: "new-event", personId: person.id, title: "Dinner", occurredAt: "2026-09-26T12:00:00Z", kind: "date", notes: null, vibe: null, source: null, externalId: null };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok({ event })));
    await detail();
    const timeline = container.querySelector("#timeline")!;
    await click(button("Add", timeline));
    const title = timeline.querySelector<HTMLInputElement>('[aria-label="Title"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Dinner");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Add", timeline));
    expect(title.value).toBe("Dinner");
    expect(button("Add", timeline).disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    await click(button("Add", timeline));
    expect(timeline.querySelector("form")).toBeNull();
    expect(timeline.textContent).toContain("Dinner");
  });

  it("re-enables Find patterns after a rejected request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok({ text: "Recovered patterns" })));
    await act(async () => root.render(<DatingHome people={[]} suggestions={[]} />));
    await click(button("Lessons"));
    await click(button("Find patterns"));
    expect(button("Find patterns").disabled).toBe(false);
    expect(container.textContent).toContain("Could not find patterns");
    await click(button("Find patterns"));
    expect(container.textContent).toContain("Recovered patterns");
  });

  it("remembers hidden lessons and keeps a pending pattern result when collapsed", async () => {
    let resolve!: (value: unknown) => void;
    const fetch = vi.fn().mockReturnValue(new Promise((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<DatingHome people={[]} suggestions={[]} />));
    const toggle = () => button("Lessons");
    const content = () => document.getElementById(toggle().getAttribute("aria-controls")!)!;
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(content().hidden).toBe(true);
    await click(toggle());
    expect(localStorage.getItem("personalos:dating-lessons-open")).toBe("1");
    await click(button("Find patterns"));
    await click(toggle());
    await act(async () => resolve(ok({ text: "A saved pattern result" })));
    expect(content().hidden).toBe(true);
    await click(toggle());
    expect(content().textContent).toContain("A saved pattern result");
    expect(fetch).toHaveBeenCalledTimes(1);
    await click(toggle());
    await act(async () => root.render(<DatingHome key="new-visit" people={[]} suggestions={[]} />));
    expect(content().hidden).toBe(true);
    expect(localStorage.getItem("personalos:dating-lessons-open")).toBe("0");
  });

  it("restores open lessons and still toggles if browser storage is unavailable", async () => {
    localStorage.setItem("personalos:dating-lessons-open", "1");
    await act(async () => root.render(<DatingHome people={[]} suggestions={[]} />));
    expect(button("Lessons").getAttribute("aria-expanded")).toBe("true");
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      await act(async () => root.render(<DatingHome key="blocked-storage" people={[]} suggestions={[]} />));
      await click(button("Lessons"));
      expect(button("Lessons").getAttribute("aria-expanded")).toBe("true");
      await click(button("Lessons"));
      expect(button("Lessons").getAttribute("aria-expanded")).toBe("false");
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });

  it("keeps an existing moment after deletion fails and permits retry", async () => {
    const event: DatingEventDTO = { id: "existing-event", personId: person.id, title: "Dinner", occurredAt: "2026-09-26T12:00:00Z", kind: "date", notes: null, vibe: null, source: null, externalId: null };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok({ ok: true })));
    await detail([event]);
    const timeline = container.querySelector("#timeline")!;
    await click(timeline.querySelector("ol button")!);
    await click(button("Delete", timeline));
    expect(timeline.querySelector("ol")?.textContent).toContain("Dinner");
    expect(button("Delete", timeline).disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not delete the moment");
    await click(button("Delete", timeline));
    expect(timeline.querySelector("ol")).toBeNull();
    expect(timeline.querySelector("form")).toBeNull();
  });

  it("rejects an empty timeline date without leaving the form busy", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await detail();
    const timeline = container.querySelector("#timeline")!;
    await click(button("Add", timeline));
    await act(async () => {
      for (const [label, value] of [["Title", "Dinner"], ["Date", ""]]) {
        const input = timeline.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await click(button("Add", timeline));
    expect(fetch).not.toHaveBeenCalled();
    expect(button("Add", timeline).disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Choose a valid date");
  });
});
