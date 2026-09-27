// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeopleBoard, type DatingCard } from "./people-board";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const person: DatingCard = {
  id: "current-person", name: "Test Person", stage: "talking",
  instagram: null, remember: [], avatarUrl: null, dateCount: 0, avgVibe: null,
  firstEventAt: null, lastEventAt: null, lastDate: null, lastMessageAt: null,
  metAt: null, endedAt: null, createdAt: "2026-09-26T12:00:00.000Z",
  handles: [], metVia: null, age: null, city: null, work: null,
  greenFlags: [], redFlags: [], notes: null, lessons: null, insights: null, insightsAt: null,
};
const paused: DatingCard = { ...person, id: "paused-person", name: "Paused Person", stage: "paused", createdAt: "2026-09-25T12:00:00.000Z" };
const past: DatingCard = { ...person, id: "past-person", name: "Past Person", stage: "ended", endedAt: "2026-08-01T12:00:00.000Z" };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("confirm", vi.fn(() => true));
  refresh.mockReset();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(people: DatingCard[] = [person]) {
  await act(async () => root.render(<PeopleBoard people={people} />));
}
const currentList = () => container.querySelector('ul[aria-label="Current relationships"]');
const pastList = () => container.querySelector('ul[aria-label="Past relationships"]');
const pastToggle = () => [...container.querySelectorAll("button")].find((button) => /Past relationships/.test(button.textContent ?? ""))!;
const card = (id: string, scope: ParentNode | null = container) => scope?.querySelector(`a[href="/dating/${id}"]`) ?? null;
function menu(name = person.name): HTMLSelectElement {
  const label = `Actions for ${name}`;
  const select = [...container.querySelectorAll("select")].find((item) =>
    item.getAttribute("aria-label") === label || [...(item.labels ?? [])].some((node) => node.textContent?.includes(label)));
  expect(select, `accessible action menu for ${name}`).toBeDefined();
  return select!;
}
function choose(select: HTMLSelectElement, value: string) {
  expect([...select.options].some((option) => option.value === value)).toBe(true);
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
async function actOn(value: string, name = person.name) {
  await act(async () => choose(menu(name), value));
}
const togglePast = async () => act(async () => pastToggle().click());
const savedStage = (stage: string) => ({ ok: true, json: async () => ({ person: { stage, endedAt: stage === "ended" ? "2026-09-26T12:00:00.000Z" : null } }) });
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

// These verify the product's grouping, navigation and mutations, not grid CSS.
describe("simple people overview", () => {
  it("shows current and paused people together, with past relationships collapsed", async () => {
    await render([paused, past, person]);
    expect(container.querySelector('section[aria-label="People"] h2')?.textContent).toBe("People");
    expect(currentList()).not.toBeNull();
    expect([...currentList()!.querySelectorAll('a[href^="/dating/"]')].map((link) => link.textContent)).toEqual([person.name, paused.name]);
    expect(card(past.id)).toBeNull();
    expect(pastList()).toBeNull();
    expect(pastToggle().textContent).toMatch(/Past relationships\s*\(1\)/);
    expect(pastToggle().getAttribute("aria-expanded")).toBe("false");
    expect(menu(paused.name)).toBeDefined();
  });

  it("expands and collapses past relationships and remembers the choice", async () => {
    await render([person, past]);
    await togglePast();
    expect(pastToggle().getAttribute("aria-expanded")).toBe("true");
    expect(card(past.id, pastList()!)).not.toBeNull();
    expect(localStorage.getItem("personalos:dating-ended-open")).toBe("1");
    await togglePast();
    expect(pastList()).toBeNull();
    expect(pastToggle().getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem("personalos:dating-ended-open")).toBe("0");
  });

  it("restores the saved past-disclosure preference", async () => {
    localStorage.setItem("personalos:dating-ended-open", "1");
    await render([person, past]);
    expect(pastToggle().getAttribute("aria-expanded")).toBe("true");
    expect(card(past.id, pastList()!)).not.toBeNull();
  });

  it.each(["board", "rows"])("ignores the old %s preference without reviving a view switch or duplicate cards", async (view) => {
    localStorage.setItem("personalos:dating-view", view);
    await render([person, paused, past]);
    expect(container.querySelector('[role="group"][aria-label="View"]')).toBeNull();
    expect(container.querySelectorAll('ul[aria-label="Current relationships"]')).toHaveLength(1);
    expect(currentList()!.querySelectorAll('a[href^="/dating/"]')).toHaveLength(2);
    expect(container.querySelector('[draggable="true"]')).toBeNull();
    expect(card(past.id)).toBeNull();
  });

  it("distinguishes an empty collection from having only past relationships", async () => {
    await render([]);
    expect(container.textContent).toContain("Add someone to get started.");
    await render([past]);
    expect(container.textContent).toMatch(/No current relationships/i);
    expect(pastToggle().textContent).toMatch(/\(1\)/);
  });

  it("keeps the person link while omitting the old overview metrics and shortcuts", async () => {
    await render([{ ...person, instagram: "synthetic_handle", remember: ["Unique private reminder"], dateCount: 7, avgVibe: 8.2, lastDate: { at: "2026-09-20T12:00:00Z", vibe: 8 } }]);
    expect(card(person.id)?.textContent).toBe(person.name);
    expect(container.textContent).not.toContain("Unique private reminder");
    expect(container.textContent).not.toContain("7 dates");
    expect(container.querySelector('[aria-label^="Average vibe"]')).toBeNull();
    expect(container.querySelector('a[href*="instagram.com"]')).toBeNull();
  });
});

describe("changing relationship status", () => {
  it("moves a card to past, updates its count, and can return it to current relationships", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(savedStage("talking"));
    vi.stubGlobal("fetch", fetch);
    await render([person, past]);
    await actOn("ended");
    expect(card(person.id, currentList()!)).toBeNull();
    expect(pastToggle().textContent).toMatch(/\(2\)/);
    await togglePast();
    expect(card(person.id, pastList()!)).not.toBeNull();
    expect(menu().disabled).toBe(true);
    await act(async () => pending.resolve(savedStage("ended")));
    expect(menu().disabled).toBe(false);
    await actOn("talking");
    expect(card(person.id, currentList()!)).not.toBeNull();
    expect(card(person.id, pastList()!)).toBeNull();
    expect(pastToggle().textContent).toMatch(/\(1\)/);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ stage: "ended" });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ stage: "talking" });
  });

  it.each(["http", "network"])("restores the current card and count after a %s move failure, then permits retry", async (failure) => {
    const fetch = vi.fn();
    if (failure === "http") fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Not saved" }) });
    else fetch.mockRejectedValueOnce(new Error("offline"));
    fetch.mockResolvedValueOnce(savedStage("ended"));
    vi.stubGlobal("fetch", fetch);
    await render([person, past]);
    await togglePast();
    await actOn("ended");
    expect(card(person.id, currentList()!)).not.toBeNull();
    expect(card(person.id, pastList()!)).toBeNull();
    expect(pastToggle().textContent).toMatch(/\(1\)/);
    expect(menu().disabled).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(`Couldn't update ${person.name}`);
    await actOn("ended");
    expect(card(person.id, pastList()!)).not.toBeNull();
    expect(pastToggle().textContent).toMatch(/\(2\)/);
  });

  it("blocks same-card moves and deletion while a status request is pending", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    await render();
    const actions = menu();
    await act(async () => {
      choose(actions, "dating");
      choose(actions, "exclusive");
      choose(actions, "delete");
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(menu().disabled).toBe(true);
    await act(async () => pending.resolve(savedStage("dating")));
    expect(menu().disabled).toBe(false);
    expect([...menu().options].some((option) => option.value === "dating")).toBe(false);
  });

  it("restores a previously saved ended status when reopening fails", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(savedStage("ended"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(savedStage("dating"));
    vi.stubGlobal("fetch", fetch);
    await render([person, past]);
    await actOn("ended");
    await togglePast();
    await actOn("dating");
    expect(card(person.id, currentList())).toBeNull();
    expect(card(person.id, pastList())).not.toBeNull();
    expect(pastToggle().textContent).toMatch(/\(2\)/);
    expect([...menu().options].some((option) => option.value === "ended")).toBe(false);
    expect(menu().disabled).toBe(false);
    await actOn("dating");
    expect(card(person.id, currentList())).not.toBeNull();
    expect(pastToggle().textContent).toMatch(/\(1\)/);
  });
});

describe("deleting a person", () => {
  it("requires confirmation before sending a delete", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await render();
    await actOn("delete");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(person.name));
    expect(fetch).not.toHaveBeenCalled();
    expect(card(person.id)).not.toBeNull();
    expect(menu().disabled).toBe(false);
  });

  it("removes a current card after successful confirmed deletion", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await render();
    await actOn("delete");
    expect(fetch).toHaveBeenCalledWith(`/api/dating/${person.id}`, { method: "DELETE" });
    expect(card(person.id)).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("updates the past count when a past card is deleted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await render([person, past, { ...past, id: "other-past", name: "Other Past" }]);
    await togglePast();
    await actOn("delete", past.name);
    expect(card(past.id)).toBeNull();
    expect(pastToggle().textContent).toMatch(/\(1\)/);
    expect(card("other-past", pastList()!)).not.toBeNull();
  });

  it.each(["http", "network"])("keeps the person visible after %s failure and allows retry", async (failure) => {
    const fetch = vi.fn();
    if (failure === "http") fetch.mockResolvedValueOnce({ ok: false });
    else fetch.mockRejectedValueOnce(new Error("offline"));
    fetch.mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await render();
    await actOn("delete");
    expect(card(person.id)).not.toBeNull();
    expect(menu().disabled).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(`Couldn't delete ${person.name}`);
    expect(refresh).not.toHaveBeenCalled();
    await actOn("delete");
    expect(card(person.id)).toBeNull();
  });

  it("prevents duplicate delete requests and status changes until deletion finishes", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    await render();
    const actions = menu();
    await act(async () => {
      choose(actions, "delete");
      choose(actions, "delete");
      choose(actions, "dating");
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(menu().disabled).toBe(true);
    await act(async () => pending.resolve({ ok: true }));
    expect(card(person.id)).toBeNull();
  });
});

async function search(query: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search people"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("finding people", () => {
  it("finds past people across accents and word order without changing the collapsed preference", async () => {
    await render([person, { ...past, name: "Renée Laurent" }]);
    await search("LAURENT renee");
    expect(card(person.id)).toBeNull();
    expect(card(past.id, pastList())).not.toBeNull();
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("1 person found");
    expect(localStorage.getItem("personalos:dating-ended-open")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click());
    expect(card(person.id)).not.toBeNull();
    expect(pastList()).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('input[aria-label="Search people"]'));
  });

  it("shows a recoverable no-match state and Escape restores the saved open section", async () => {
    localStorage.setItem("personalos:dating-ended-open", "1");
    await render([person, past]);
    await search("Nobody matching");
    expect(container.textContent).toContain("No people match");
    expect(card(person.id)).toBeNull();
    expect(card(past.id)).toBeNull();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search people"]')!;
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(input.value).toBe("");
    expect(card(past.id, pastList())).not.toBeNull();
    expect(pastToggle().getAttribute("aria-expanded")).toBe("true");
    expect(localStorage.getItem("personalos:dating-ended-open")).toBe("1");
  });

  it("clears a no-match query with Show everyone", async () => {
    await render([person, past]);
    await search("Missing");
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Show everyone")!.click());
    expect(card(person.id)).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Search people"]')!.value).toBe("");
  });

  it("orders past cards by relationship dates despite later note imports", async () => {
    localStorage.setItem("personalos:dating-ended-open", "1");
    await render([
      { ...past, id: "older", name: "Older", endedAt: "2024-01-01", lastEventAt: "2026-09-26" },
      { ...past, id: "recent", name: "Recent", endedAt: "2026-01-01", lastEventAt: "2026-01-01" },
    ]);
    expect([...pastList()!.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Recent", "Older"]);
  });

  it("keeps refreshed names and photos after a status update", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(savedStage("dating")));
    await render();
    await actOn("dating");
    await render([{ ...person, stage: "dating", name: "Updated Name", avatarUrl: "/api/dating/photos/new/content" }]);
    expect(card(person.id)?.textContent).toBe("Updated Name");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/dating/photos/new/content");
    await search("updated");
    expect(card(person.id)).not.toBeNull();
  });
});
