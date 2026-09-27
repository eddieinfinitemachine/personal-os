// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatingPersonDTO, DatingEventDTO } from "@/lib/dating-server";
import { DatingDetail } from "./dating-detail";
import { DatingHome } from "./dating-home";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("./dictate-card", () => ({ DictateCard: () => null }));
vi.mock("./photo-strip", () => ({ PhotoStrip: () => null }));
vi.mock("./relationship-chart", () => ({ RelationshipChart: () => null }));
vi.mock("./sync-help", () => ({ SyncHelp: () => null }));
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
    await click(button("Read everything with Claude"));
    expect(button("Read everything with Claude").disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not read");
    await click(button("Read everything with Claude"));
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
    await click(button("Find patterns"));
    expect(button("Find patterns").disabled).toBe(false);
    expect(container.textContent).toContain("Could not find patterns");
    await click(button("Find patterns"));
    expect(container.textContent).toContain("Recovered patterns");
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
