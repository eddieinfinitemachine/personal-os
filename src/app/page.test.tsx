// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ count: vi.fn(), session: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "example.invalid" }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/hosts", () => ({ isPrivateHost: () => false }));
vi.mock("@/lib/cron", () => ({ isFounderUser: async () => false }));
vi.mock("@/lib/lists", () => ({ ensureDefaultLists: async () => {} }));
vi.mock("@/lib/list-access", () => ({
  listAccessWhere: () => ({ userId: "user" }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    list: {
      findMany: async () => [
        {
          id: "list",
          name: "To Do",
          userId: "user",
          color: "zinc",
          isDefault: true,
          user: { name: "Test", email: "test@example.invalid" },
          members: [],
          _count: { members: 0 },
        },
      ],
    },
    todo: {
      findMany: async () => [
        {
          id: "todo",
          listId: "list",
          projectId: "project",
          title: "Read",
          user: null,
          _count: { attachments: 0 },
          subtasks: [],
        },
      ],
    },
    comment: { findMany: async () => [] },
    commentRead: { findMany: async () => [] },
    captureReview: { count: mocks.count },
  },
}));
vi.mock("@/components/home-tiles", () => ({
  HomeTiles: () => (
    <div data-home-tiles>Existing mobile pager and list tiles</div>
  ),
}));
vi.mock("@/components/new-list-button", () => ({ NewListButton: () => null }));
vi.mock("@/components/import-granola-button", () => ({
  ImportGranolaButton: () => null,
}));
vi.mock("@/components/ec-landing", () => ({
  EcLanding: () => <div>Public landing</div>,
}));
vi.mock("@/components/capture-inbox", () => ({ CaptureInboxPill: () => null }));
vi.mock("@/components/keyboard-nav", () => ({ KeyboardListNav: () => null }));
import HomePage from "./page";
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.session.mockResolvedValue({ userId: "user" });
  mocks.count.mockReset().mockResolvedValue(0);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = async () => {
  const page = await HomePage();
  await act(async () => root.render(page));
};
describe("Home Capture Inbox placement", () => {
  const capturesLink = () =>
    container.querySelector<HTMLAnchorElement>('a[href="/captures"]');
  it("keeps the Capture Inbox off Home and links to /captures from the header", async () => {
    await render();
    expect(container.querySelector("[data-home-tiles]")).not.toBeNull();
    expect(container.textContent).not.toContain("Capture Inbox:");
    expect(container.textContent).not.toContain("By project");
    expect(capturesLink()?.textContent).toBe("Captures");
    expect(mocks.count).toHaveBeenCalledWith({
      where: { userId: "user", dismissedAt: null },
    });
  });
  it("shows how many captures are waiting", async () => {
    mocks.count.mockResolvedValue(4);
    await render();
    expect(capturesLink()?.textContent).toBe("Captures · 4");
  });
  it("keeps Home lists and the link when the count read fails", async () => {
    mocks.count.mockRejectedValue(new Error("database unavailable"));
    await render();
    expect(container.querySelector("[data-home-tiles]")).not.toBeNull();
    expect(capturesLink()?.textContent).toBe("Captures");
  });
  it("does not read private captures for a visitor", async () => {
    mocks.session.mockResolvedValue(null);
    await render();
    expect(container.textContent).toContain("Public landing");
    expect(mocks.count).not.toHaveBeenCalled();
  });
});
