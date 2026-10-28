// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }) }));
import { ProjectsBoardView, syncedLabel } from "./projects-board";
import type { BoardCard, ProjectsBoard } from "@/lib/projects/board-model";

const NOW = Date.now();
const card = (name: string, hoursAgo: number, over: Partial<BoardCard> = {}): BoardCard => ({
  id: `repo:${name}`,
  name,
  company: "Personal",
  visibility: "auto",
  lastActivityAt: new Date(NOW - hoursAgo * 3600_000).toISOString(),
  activity: [],
  plan: [],
  planTotal: 0,
  githubUrl: null,
  homepageUrl: null,
  sourceId: `s-${name}`,
  ...over,
});
const board: ProjectsBoard = {
  cards: [card("rushmore", 1, { company: "Olto" }), card("personal-os", 5)],
  hidden: [],
  syncedAt: null,
};

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
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label)!;
const hiddenDetails = () =>
  [...container.querySelectorAll("details")].find((d) => d.querySelector("summary")?.textContent?.startsWith("Hidden"));
const shownNames = () =>
  [...container.querySelectorAll("article")]
    .filter((a) => !a.closest("details"))
    .map((a) => a.querySelector("h3")?.textContent);

async function hide(name = "rushmore") {
  await act(async () => button(`More actions for ${name}`).click());
  await act(async () => button("Hide").click());
}

describe("ProjectsBoardView", () => {
  it("renders repos newest first with their company, as plain headings", async () => {
    await act(async () =>
      root.render(<ProjectsBoardView board={{ ...board, cards: [board.cards[1], board.cards[0]] }} />),
    );
    expect(shownNames()).toEqual(["rushmore", "personal-os"]);
    const first = container.querySelector("[data-card-id='repo:rushmore']")!;
    expect(first.querySelector("h3 + div")?.textContent).toBe("Olto");
    expect(first.querySelector("a")).toBeNull();
    expect(hiddenDetails()).toBeUndefined();
  });

  it("shows the empty state when nothing is active", async () => {
    await act(async () => root.render(<ProjectsBoardView board={{ cards: [], hidden: [], syncedAt: null }} />));
    expect(container.textContent).toContain("No repos with your commits in the last 14 days.");
    expect(container.querySelector("article")).toBeNull();
  });

  it("moves a card to Hidden at once and PATCHes the repo row", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    await hide();
    expect(shownNames()).toEqual(["personal-os"]);
    expect(hiddenDetails()?.querySelector("summary")?.textContent).toBe("Hidden · 1");
    expect(hiddenDetails()?.querySelector("[data-card-id='repo:rushmore']")).not.toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/projects/sources/s-rushmore", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "hidden" }),
    });
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(nav.refresh).toHaveBeenCalledOnce();
  });

  it("drops optimistic overrides when a refreshed board lands", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    await hide();
    expect(shownNames()).toEqual(["personal-os"]);
    // The server says rushmore is still visible (e.g. hidden elsewhere then unhidden).
    await act(async () => root.render(<ProjectsBoardView board={{ ...board }} />));
    expect(shownNames()).toEqual(["rushmore", "personal-os"]);
    expect(hiddenDetails()).toBeUndefined();
  });

  it("rolls a hide back and says so when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    await hide();
    expect(hiddenDetails()).toBeUndefined();
    expect(shownNames()).toEqual(["rushmore", "personal-os"]);
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Couldn't update rushmore. Try again.");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("rolls a hide back on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    await hide();
    expect(hiddenDetails()).toBeUndefined();
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Couldn't update rushmore. Try again.");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("shows commit activity without prefixes", async () => {
    const withActivity = card("rushmore", 1, {
      activity: [{ kind: "commit", text: "Fix booking", at: new Date(NOW - 3600_000).toISOString(), branch: "feat/x", url: "u" }],
    });
    await act(async () => root.render(<ProjectsBoardView board={{ ...board, cards: [withActivity] }} />));
    const row = container.querySelector("[data-card-id='repo:rushmore'] li")!;
    expect(row.textContent).toContain("Fix booking");
    expect(row.textContent).toContain("feat/x");
    expect(row.textContent).not.toMatch(/Met:|Done:/);
  });
});

describe("syncedLabel", () => {
  it("adds 'ago' only to relative times", () => {
    const at = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(syncedLabel(null)).toBe("Never synced");
    expect(syncedLabel(at(5_000))).toBe("Synced now");
    expect(syncedLabel(at(50_000))).toBe("Synced now");
    expect(syncedLabel(at(12 * 60_000))).toBe("Synced 12m ago");
    expect(syncedLabel(at(3 * 3600_000))).toBe("Synced 3h ago");
    expect(syncedLabel(at(2 * 86400_000))).toBe("Synced 2d ago");
    const old = syncedLabel(at(10 * 86400_000));
    expect(old).toMatch(/^Synced \w{3} \d{1,2}$/);
    expect(old).not.toContain("ago");
  });
});
