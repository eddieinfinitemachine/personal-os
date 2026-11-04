// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  review: vi.fn(),
  lists: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/capture-review/read", () => ({
  listCaptureReviews: mocks.review,
}));
vi.mock("@/lib/list-access", () => ({
  listAccessWhere: () => ({ userId: "user" }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    list: { findMany: mocks.lists },
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/components/mobile-chrome", () => ({ PageHeader: () => null }));
vi.mock("@/components/capture-review-inbox", () => ({
  CaptureReviewInbox: (props: {
    initialState: string;
    fullPage: boolean;
    initialError: string | null;
  }) => (
    <section>
      {props.initialError ??
        `${props.initialState}:${props.fullPage ? "full" : "compact"}`}
    </section>
  ),
}));
import CapturesPage from "./page";
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.session.mockReset().mockResolvedValue({ userId: "user" });
  mocks.review
    .mockReset()
    .mockResolvedValue({
      items: [],
      total: 0,
      offset: 20,
      limit: 10,
      hasMore: false,
    });
  mocks.lists.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("all capture reviews", () => {
  it("requires a session before reading captures or destination choices", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(
      CapturesPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("redirect:/login");
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("loads the dismissed state and bounded offset from awaited search params", async () => {
    const page = await CapturesPage({
      searchParams: Promise.resolve({ state: "dismissed", offset: "20" }),
    });
    await act(async () => root.render(page));
    expect(mocks.review).toHaveBeenCalledWith("user", {
      state: "dismissed",
      offset: 20,
      limit: 10,
    });
    expect(container.textContent).toContain("dismissed:full");
    expect(container.querySelector('a[href="/"]')?.textContent).toBe("Home");
  });
  it("uses pending and page zero for invalid query values and shows a recoverable error", async () => {
    mocks.review.mockRejectedValue(new Error("offline"));
    const page = await CapturesPage({
      searchParams: Promise.resolve({ state: "other", offset: "-3" }),
    });
    await act(async () => root.render(page));
    expect(mocks.review).toHaveBeenCalledWith("user", {
      state: "pending",
      offset: 0,
      limit: 10,
    });
    expect(container.textContent).toContain("Could not load captures");
  });
});
