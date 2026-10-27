// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }) }));
import { ProjectsBoardView, syncedLabel } from "./projects-board";
import type { BoardCard, ProjectsBoard } from "@/lib/projects/board-model";

const NOW = Date.now();
const card: BoardCard = {
  id: "repo:s1",
  kind: "repo",
  name: "rushmore",
  company: "Personal",
  visibility: "auto",
  lastActivityAt: new Date(NOW - 3600_000).toISOString(),
  activity: [],
  plan: [],
  planTotal: 0,
  href: null,
  githubUrl: null,
  homepageUrl: null,
  projectId: null,
  sourceId: "s1",
};
const board: ProjectsBoard = {
  suggested: [{ id: "t1", name: "Series A", company: "Infinite Machine", meetings: 2, lastMeetingAt: null }],
  groups: [{ company: "Personal", cards: [card] }],
  dormant: [],
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
const hiddenSummary = () => [...container.querySelectorAll("summary")].find((s) => s.textContent?.startsWith("Hidden"));

async function hide() {
  await act(async () => button("More actions for rushmore").click());
  await act(async () => button("Hide").click());
}

describe("ProjectsBoardView failures", () => {
  it("rolls a hide back and says so when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    await hide();
    expect(hiddenSummary()).toBeUndefined();
    expect(container.querySelector("section[aria-label=Personal] [data-card-id='repo:s1']")).not.toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Couldn't update rushmore. Try again.");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("rolls a hide back on a non-OK response, and keeps it on success", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    await hide();
    expect(hiddenSummary()).toBeUndefined();
    expect(container.querySelector("[role=alert]")).not.toBeNull();

    fetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await hide();
    expect(hiddenSummary()?.textContent).toBe("Hidden · 1");
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(nav.refresh).toHaveBeenCalledOnce();
  });

  it("shows an error and keeps the suggestion when Accept or Dismiss fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("{}", { status: 409 })).mockRejectedValueOnce(new TypeError("offline")),
    );
    await act(async () => root.render(<ProjectsBoardView board={board} />));
    await act(async () => button("Accept").click());
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Couldn't accept Series A. Try again.");
    expect(container.textContent).toContain("Series A");
    await act(async () => button("Dismiss").click());
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Couldn't dismiss Series A. Try again.");
    expect(nav.refresh).not.toHaveBeenCalled();
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
