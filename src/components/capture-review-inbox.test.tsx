// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureReviewInbox } from "./capture-review-inbox";
import type {
  CaptureReviewItem,
  CaptureReviewList,
} from "@/lib/capture-review/types";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
export const review = (
  over: Partial<CaptureReviewItem> = {},
): CaptureReviewItem => ({
  id: "review",
  source: "ec",
  sourceLabel: "ec",
  input: {
    text: "Read The Creative Act",
    url: "https://example.com/book",
    files: [
      {
        name: "cover.jpg",
        mimeType: "image/jpeg",
        size: 2048,
        url: "https://example.com/cover.jpg",
      },
    ],
  },
  proposal: { type: "asset", assetKind: "media", title: "The Creative Act" },
  placement: {
    type: "asset",
    id: "book",
    title: "The Creative Act",
    destination: "Media → Books",
    path: "/media/book",
    related: [
      {
        type: "todo",
        id: "task",
        title: "Read the book",
        destination: "Later",
        path: "/lists/later?todo=task",
      },
    ],
  },
  fields: {},
  revision: 1,
  dismissedAt: null,
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  correctedAt: null,
  correctable: true,
  movable: true,
  ...over,
});
const list = (items = [review()], total = items.length): CaptureReviewList => ({
  items,
  total,
  hasMore: total > items.length,
  offset: 0,
  limit: 10,
});
const ok = (value: unknown) => ({ ok: true, json: async () => value });
let container: HTMLDivElement, root: Root, visibility: string;
const click = async (label: string) =>
  act(async () => {
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === label)!
      .click();
  });
async function render(
  initialData: CaptureReviewList | null = list(),
  extra: Record<string, unknown> = {},
) {
  await act(async () =>
    root.render(<CaptureReviewInbox initialData={initialData} {...extra} />),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.refresh.mockReset();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility as DocumentVisibilityState,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Capture Inbox", () => {
  it("shows source, original input/files, live placement, related tasks and first-ten navigation", async () => {
    await render(list([review()], 12));
    expect(container.querySelector("h2")?.textContent).toBe("Capture Inbox");
    expect(container.textContent).toContain("12 pending");
    expect(container.textContent).toContain("from ec");
    expect(container.textContent).toContain("Read The Creative Act");
    expect(container.textContent).toContain("cover.jpg · 2 KB");
    expect(container.textContent).toContain("Placed in Media → Books");
    expect(container.textContent).toContain("Read the book · Later");
    expect(container.querySelector('a[href="/media/book"]')?.textContent).toBe(
      "Open",
    );
    expect(container.querySelector('a[href="/captures"]')?.textContent).toBe(
      "Show all",
    );
    expect(
      container.querySelector('a[href="/captures?state=dismissed"]')
        ?.textContent,
    ).toBe("Dismissed");
  });
  it("keeps failed loads distinct from empty and retries without a page reload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(list([]))));
    await render(null, { initialError: "Could not load captures." });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not load",
    );
    expect(container.textContent).not.toContain("All caught up");
    await click("Retry");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("All caught up");
  });
  it("dismisses only the review and restores using the returned revision", async () => {
    const dismissed = review({
      revision: 2,
      dismissedAt: "2026-11-01T13:00:00Z",
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok({ review: dismissed }))
      .mockResolvedValueOnce(ok(list([])))
      .mockResolvedValueOnce(ok({ review: review({ revision: 3 }) }))
      .mockResolvedValueOnce(ok(list([review({ revision: 3 })])));
    vi.stubGlobal("fetch", fetcher);
    await render();
    await click("Dismiss");
    expect(container.textContent).not.toContain("Placed in");
    expect(container.textContent).toContain("Dismissed The Creative Act");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      revision: 1,
      action: "dismiss",
    });
    await click("Undo");
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
      revision: 2,
      action: "restore",
    });
    expect(container.textContent).toContain("Placed in Media → Books");
    expect(
      fetcher.mock.calls.every(([, options]) => options?.method !== "DELETE"),
    ).toBe(true);
  });
  it("retains the row and shows server conflicts without claiming dismissal", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 409,
          json: async () => ({
            error: "Capture changed. Refresh and try again.",
          }),
        }),
    );
    await render();
    await click("Dismiss");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Capture changed",
    );
    expect(container.textContent).toContain("Placed in Media → Books");
    expect(container.textContent).not.toContain("Dismissed The Creative Act");
  });
  it("refreshes Home only when the capture fingerprint changes, including outside placement moves", async () => {
    const changed = list([
      review({
        placement: { ...review().placement, destination: "Media → Reading" },
      }),
    ]);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok(list()))
      .mockResolvedValueOnce(ok(changed))
      .mockResolvedValue(ok(changed));
    vi.stubGlobal("fetch", fetcher);
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(navigation.refresh).not.toHaveBeenCalled();
    await act(async () =>
      window.dispatchEvent(new Event("personalos:capture-saved")),
    );
    expect(container.textContent).toContain("Media → Reading");
    expect(navigation.refresh).toHaveBeenCalledOnce();
    await render(changed);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
  it("does not poll or refresh on focus while hidden and resumes when visible", async () => {
    const fetcher = vi.fn().mockResolvedValue(ok(list()));
    vi.stubGlobal("fetch", fetcher);
    visibility = "hidden";
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetcher).not.toHaveBeenCalled();
    visibility = "visible";
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("shows removed destinations without offering unsafe correction or an invalid Open link", async () => {
    await render(
      list([
        review({
          placement: { ...review().placement, missing: true },
          correctable: false,
          movable: false,
        }),
      ]),
    );
    expect(container.textContent).toContain("Saved item removed");
    expect(
      [...container.querySelectorAll("button")].some(
        (b) => b.textContent === "Correct",
      ),
    ).toBe(false);
    expect(
      [...container.querySelectorAll("a")].some(
        (b) => b.textContent === "Open",
      ),
    ).toBe(false);
    expect(container.textContent).toContain("Dismiss");
  });
  it("does not let a delayed poll overwrite a completed dismissal", async () => {
    let finish!: (value: unknown) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(
        ok({
          review: review({ revision: 2, dismissedAt: "2026-11-01T13:00:00Z" }),
        }),
      )
      .mockResolvedValueOnce(ok(list([])));
    vi.stubGlobal("fetch", fetcher);
    await render();
    await act(async () => window.dispatchEvent(new Event("focus")));
    await click("Dismiss");
    await act(async () => finish(ok(list())));
    expect(container.textContent).not.toContain("Placed in Media");
    expect(container.textContent).toContain("Dismissed The Creative Act");
  });
  it("pins the draft revision when polling sees an outside change", async () => {
    const current = review();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok(list([review({ revision: 2 })])))
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: "Capture changed elsewhere" }),
      });
    vi.stubGlobal("fetch", fetcher);
    await render(list([current]));
    await click("Correct");
    await act(async () => window.dispatchEvent(new Event("focus")));
    await click("Save correction");
    expect(JSON.parse(fetcher.mock.calls[1][1].body).revision).toBe(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Capture changed elsewhere",
    );
  });
  it("does not expose unsafe saved-record paths as navigation", async () => {
    await render(
      list([
        review({
          placement: {
            ...review().placement,
            path: "//outside.invalid",
            related: [
              {
                type: "todo",
                id: "unsafe",
                title: "Untrusted link",
                destination: "Later",
                path: "javascript:alert(1)",
              },
            ],
          },
        }),
      ]),
    );
    expect(
      [...container.querySelectorAll("a")].some(
        (item) => item.textContent === "Open",
      ),
    ).toBe(false);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.textContent).toContain("Untrusted link");
  });
  it("paginates dismissed reviews and restores entries", async () => {
    const dismissed = review({
      dismissedAt: "2026-11-01T13:00:00Z",
      revision: 2,
    });
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        ok({ ...list([dismissed], 11), offset: 10, hasMore: false }),
      );
    vi.stubGlobal("fetch", fetcher);
    await render(list([dismissed], 11), {
      fullPage: true,
      initialState: "dismissed",
    });
    await click("Next");
    expect(fetcher.mock.calls[0][0]).toBe(
      "/api/capture-reviews?state=dismissed&offset=10&limit=10",
    );
    expect(container.textContent).toContain("Restore");
    expect(navigation.refresh).not.toHaveBeenCalled();
  });
});
