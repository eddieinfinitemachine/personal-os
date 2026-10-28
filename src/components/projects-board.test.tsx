// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }) }));
import { ProjectsBoardView, ProjectsSyncStatus, countsLabel, failedLabel, syncedLabel, whenLabel } from "./projects-board";
import type { BoardCard, ProjectsBoard } from "@/lib/projects/board-model";

const NOW = Date.now();
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3600_000).toISOString();
const card = (name: string, hoursAgo: number, over: Partial<BoardCard> = {}): BoardCard => ({
  id: `inferred:${name}`,
  name,
  company: "Personal",
  visibility: "auto",
  lastActivityAt: iso(hoursAgo),
  status: null,
  next: null,
  evidence: [],
  stale: false,
  sourceId: `s-${name}`,
  ...over,
});
const launch = card("Product launch", 1, {
  company: "Olto",
  status: "Pricing settled, site copy in review",
  next: "Launch sync Thursday",
  evidence: [
    { ref: "gcal:1", kind: "meeting", title: "Launch sync", at: iso(-49), url: "https://calendar.google.com/x" },
    { ref: "gmail:2", kind: "email", title: "Site copy", at: iso(1), url: "https://mail.google.com/y" },
    { ref: "gmail:3", kind: "email", title: "Pricing", at: iso(30), url: "https://mail.google.com/z" },
    { ref: "todo:4", kind: "todo", title: "Write FAQ", at: iso(5), url: "/projects/p1" },
  ],
});
const board: ProjectsBoard = { cards: [launch, card("Apartment search", 5)], hidden: [], syncedAt: null, refreshFailed: false };

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  nav.refresh.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  )!;
const hiddenDetails = () =>
  [...container.querySelectorAll("details")].find((d) => d.querySelector("summary")?.textContent?.startsWith("Hidden"));
const shownNames = () =>
  [...container.querySelectorAll("article")].filter((a) => !a.closest("details")).map((a) => a.querySelector("h3")?.textContent);

async function choose(name: string, action: string) {
  await act(async () => button(`More actions for ${name}`).click());
  await act(async () => button(action).click());
}

describe("ProjectsBoardView", () => {
  it("renders name, company, status, Next and the evidence counts", async () => {
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    expect(shownNames()).toEqual(["Product launch", "Apartment search"]);
    const el = container.querySelector("[data-card-id='inferred:Product launch']")!;
    expect(el.querySelector("h3 + div")?.textContent).toBe("Olto");
    expect(el.textContent).toContain("Pricing settled, site copy in review");
    expect(el.textContent).toContain("Next: Launch sync Thursday");
    const toggle = el.querySelector("button[aria-expanded]")!;
    expect(toggle.textContent).toBe("1 meeting · 2 emails · 1 todo");
    expect(el.querySelector("ul")).toBeNull();
  });

  it("expands the evidence with links; upcoming items say 'in 2d'", async () => {
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    const el = container.querySelector("[data-card-id='inferred:Product launch']")!;
    await act(async () => (el.querySelector("button[aria-expanded]") as HTMLButtonElement).click());
    const rows = [...el.querySelectorAll("li")];
    expect(rows.map((r) => r.querySelector("span.truncate")?.textContent)).toEqual(["Launch sync", "Site copy", "Pricing", "Write FAQ"]);
    expect(rows[0].textContent).toContain("in 2d");
    const links = [...el.querySelectorAll("li a")] as HTMLAnchorElement[];
    expect(links[0].getAttribute("href")).toBe("https://calendar.google.com/x");
    expect(links[0].target).toBe("_blank");
    // In-app links open in place.
    expect(links[3].getAttribute("href")).toBe("/projects/p1");
    expect(links[3].target).toBe("");
  });

  it("shows the empty state", async () => {
    await act(async () => root.render(<ProjectsBoardView board={{ ...board, cards: [] }} />));
    expect(container.textContent).toContain("No projects inferred yet.");
    expect(container.querySelector("article")).toBeNull();
  });

  it("'Not a project' moves a card to Hidden at once and PATCHes the row", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    await choose("Product launch", "Not a project");
    expect(shownNames()).toEqual(["Apartment search"]);
    expect(hiddenDetails()?.querySelector("summary")?.textContent).toBe("Hidden · 1");
    expect(fetch).toHaveBeenCalledWith("/api/projects/sources/s-Product launch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "hidden" }),
    });
    expect(nav.refresh).toHaveBeenCalledOnce();
  });

  it("pins to the top, and unhides", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const withHidden = { ...board, hidden: [card("Old thing", 2, { visibility: "hidden" })] };
    await act(async () => root.render(<ProjectsBoardView board={withHidden} />));
    await choose("Apartment search", "Pin");
    expect(shownNames()).toEqual(["Apartment search", "Product launch"]);
    expect(container.querySelector("[data-card-id='inferred:Apartment search'] [aria-label=Pinned]")).not.toBeNull();
    await choose("Old thing", "Unhide");
    expect(hiddenDetails()).toBeUndefined();
    expect(shownNames()).toContain("Old thing");
    expect(fetch.mock.calls.map((c) => JSON.parse(c[1].body).state)).toEqual(["pinned", "auto"]);
  });

  it("says when a pinned card has gone quiet", async () => {
    const quiet = card("Quiet", 24 * 20, { visibility: "pinned", stale: true });
    await act(async () => root.render(<ProjectsBoardView board={{ ...board, cards: [quiet] }} />));
    expect(container.textContent).toMatch(/No activity since \w{3} \d{1,2}/);
  });

  it("rolls a change back and says so when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    await choose("Product launch", "Not a project");
    expect(hiddenDetails()).toBeUndefined();
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Couldn't update Product launch. Try again.");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("drops optimistic overrides when a refreshed board lands", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    await choose("Product launch", "Not a project");
    await act(async () => root.render(<ProjectsBoardView board={{ ...board }} />));
    expect(shownNames()).toEqual(["Product launch", "Apartment search"]);
  });
});

describe("ProjectsSyncStatus", () => {
  it("shows the failed state, and the refreshing label while a run is in flight", async () => {
    let resolve: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    await act(async () => root.render(<ProjectsSyncStatus syncedAt={iso(3)} refreshFailed />));
    expect(container.textContent).toContain("Last refresh failed · showing 3h ago");
    await act(async () => button("Refresh").click());
    expect(container.textContent).toContain("Refreshing… about a minute");
    await act(async () => resolve(new Response(JSON.stringify({ error: "Refresh failed (gmail: HTTP 429)" }), { status: 502 })));
    expect(container.textContent).toContain("Refresh failed (gmail: HTTP 429)");
    expect(nav.refresh).toHaveBeenCalledOnce();
  });
});

describe("labels", () => {
  it("syncedLabel adds 'ago' only to relative times", () => {
    const at = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(syncedLabel(null)).toBe("Never synced");
    expect(syncedLabel(at(5_000))).toBe("Synced now");
    expect(syncedLabel(at(12 * 60_000))).toBe("Synced 12m ago");
    expect(syncedLabel(at(2 * 86400_000))).toBe("Synced 2d ago");
    expect(syncedLabel(at(10 * 86400_000))).toMatch(/^Synced \w{3} \d{1,2}$/);
  });

  it("failedLabel and whenLabel", () => {
    expect(failedLabel(null)).toBe("Last refresh failed");
    expect(failedLabel(new Date(Date.now() - 5_000).toISOString())).toBe("Last refresh failed · showing just now");
    const now = Date.parse("2026-10-27T18:00:00Z");
    expect(whenLabel("2026-10-29T18:00:00Z", now)).toBe("in 2d");
    expect(whenLabel("2026-10-27T21:00:00Z", now)).toBe("in 3h");
    expect(whenLabel("2026-10-27T18:20:00Z", now)).toBe("in 20m");
    expect(whenLabel("not a date", now)).toBe("");
  });

  it("countsLabel skips empty kinds", () => {
    expect(countsLabel([{ ref: "note:1", kind: "note", title: "n", at: iso(1), url: null }])).toBe("1 note");
  });
});
