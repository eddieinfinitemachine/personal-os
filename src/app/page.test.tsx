// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureReviewList } from "@/lib/capture-review/types";
const mocks = vi.hoisted(() => ({ review: vi.fn(), session: vi.fn() }));
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
vi.mock("@/lib/capture-review/read", () => ({
  listCaptureReviews: mocks.review,
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
  },
}));
vi.mock("@/components/home-tiles", () => ({
  HomeTiles: () => (
    <div data-home-tiles>Existing mobile pager and list tiles</div>
  ),
}));
vi.mock("@/components/capture-review-inbox", () => ({
  CaptureReviewInbox: ({
    initialData,
    initialError,
    compact,
  }: {
    initialData: CaptureReviewList | null;
    initialError: string | null;
    compact?: boolean;
  }) => (
    <section data-capture-review data-compact={compact || undefined}>
      {initialError ?? `Capture Inbox: ${initialData?.total}`}
    </section>
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
  mocks.review
    .mockReset()
    .mockResolvedValue({
      items: [],
      total: 0,
      offset: 0,
      limit: 10,
      hasMore: false,
    });
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
  it("renders a compact Inbox, then list tiles, with no By project section", async () => {
    await render();
    const inbox = container.querySelector("[data-capture-review]")!,
      tiles = container.querySelector("[data-home-tiles]")!;
    expect(inbox).not.toBeNull();
    expect(inbox.hasAttribute("data-compact")).toBe(true);
    expect(
      inbox.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.textContent).not.toContain("By project");
    expect(mocks.review).toHaveBeenCalledWith("user", {
      state: "pending",
      offset: 0,
      limit: 10,
    });
  });
  it("keeps Home lists available when the review read fails", async () => {
    mocks.review.mockRejectedValue(new Error("database unavailable"));
    await render();
    expect(
      container.querySelector("[data-capture-review]")?.textContent,
    ).toContain("Could not load captures");
    expect(container.querySelector("[data-home-tiles]")).not.toBeNull();
  });
  it("does not read private captures for a visitor", async () => {
    mocks.session.mockResolvedValue(null);
    await render();
    expect(container.textContent).toContain("Public landing");
    expect(mocks.review).not.toHaveBeenCalled();
  });
});
