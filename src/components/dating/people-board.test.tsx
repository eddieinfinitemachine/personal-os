// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeopleBoard, type DatingCard } from "./people-board";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const person: DatingCard = {
  id: "board-delete-person", name: "Test Person", stage: "talking",
  instagram: null, remember: [], avatarUrl: null, dateCount: 0, avgVibe: null,
  firstEventAt: null, lastEventAt: null, lastDate: null, lastMessageAt: null,
  metAt: null, endedAt: null, createdAt: "2026-09-26T12:00:00.000Z",
  handles: [], metVia: null, age: null, city: null, work: null,
  greenFlags: [], redFlags: [], notes: null, lessons: null, insights: null, insightsAt: null,
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
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
async function render(view: string) {
  localStorage.setItem("personalos:dating-view", view);
  await act(async () => root.render(<PeopleBoard people={[person]} />));
}
async function remove() {
  const menu = container.querySelector("select")!;
  expect([...menu.options].some((option) => option.value === "delete")).toBe(true);
  await act(async () => {
    menu.value = "delete";
    menu.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("delete a person from the board", () => {
  it("requires confirmation before sending a delete", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await render("board");
    await remove();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Test Person"));
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector('a[href="/dating/board-delete-person"]')).not.toBeNull();
  });
  it.each(["board", "rows"])("removes the card after successful deletion in %s", async (view) => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await render(view);
    await remove();
    expect(fetch).toHaveBeenCalledWith("/api/dating/board-delete-person", { method: "DELETE" });
    expect(container.querySelector('a[href="/dating/board-delete-person"]')).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
  });
  it.each(["http", "network"])("keeps the person visible after %s failure and allows retry", async (failure) => {
    const fetch = vi.fn();
    if (failure === "http") fetch.mockResolvedValueOnce({ ok: false });
    else fetch.mockRejectedValueOnce(new Error("offline"));
    fetch.mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await render("rows");
    await remove();
    expect(container.querySelector('a[href="/dating/board-delete-person"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Couldn't delete Test Person");
    expect(refresh).not.toHaveBeenCalled();
    await remove();
    expect(container.querySelector('a[href="/dating/board-delete-person"]')).toBeNull();
  });
});
