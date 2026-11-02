// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureReviewEditor } from "./capture-review-editor";
import type { CaptureReviewItem } from "@/lib/capture-review/types";
const row = (over: Partial<CaptureReviewItem> = {}): CaptureReviewItem => ({
  id: "review",
  source: "web",
  sourceLabel: "Web",
  input: { text: "Keep this", url: null, files: [] },
  proposal: {
    type: "todo",
    title: "Keep this",
    notes: "Original notes",
    listName: "Later",
  },
  placement: {
    type: "todo",
    id: "task",
    title: "Keep this",
    destination: "Later",
    path: "/lists/later",
  },
  fields: { listId: "later" },
  revision: 4,
  dismissedAt: null,
  createdAt: "2026-11-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
  correctedAt: null,
  correctable: true,
  movable: true,
  ...over,
});
let container: HTMLDivElement, root: Root;
const saved = vi.fn(),
  cancel = vi.fn();
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  )!;
const control = (name: string) =>
  container.querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(`[name="${name}"]`)!;
async function change(name: string, value: string) {
  const target = control(name);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      target instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : target instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
      "value",
    )!.set!.call(target, value);
    target.dispatchEvent(
      new Event(target instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
const click = async (label: string) => act(async () => button(label).click());
const render = async (review = row()) =>
  act(async () =>
    root.render(
      <CaptureReviewEditor
        review={review}
        projects={[{ id: "project", name: "Reading" }]}
        lists={[
          { id: "later", name: "Later" },
          { id: "today", name: "To Do" },
        ]}
        onSaved={saved}
        onCancel={cancel}
      />,
    ),
  );
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  saved.mockReset();
  cancel.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("capture corrections", () => {
  it("keeps the title when changing destination type and restores a previous draft", async () => {
    await render();
    await change("title", "My corrected title");
    await change("type", "asset");
    expect(control("title").value).toBe("My corrected title");
    await change("title", "Asset draft");
    await change("type", "todo");
    expect(control("title").value).toBe("My corrected title");
    await change("type", "asset");
    expect(control("title").value).toBe("Asset draft");
  });
  it("saves the existing capture through its revision-guarded correction endpoint and preserves other proposal fields", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ review: row({ revision: 5 }) }),
    });
    vi.stubGlobal("fetch", fetcher);
    await render();
    await change("title", "Read this");
    await change("listId", "today");
    await change("projectId", "project");
    await click("Save correction");
    expect(fetcher.mock.calls[0][0]).toBe(
      "/api/capture-reviews/review/correct",
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      revision: 4,
      proposal: {
        type: "todo",
        title: "Read this",
        notes: "Original notes",
        listName: "To Do",
        projectId: "project",
      },
      fields: { listId: "today", projectId: "project" },
    });
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 5 }),
    );
  });
  it("offers only the five core move types and requires missing fields before saving a newly selected type", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await render();
    expect(
      [...control("type").querySelectorAll("option")].map((o) => o.value),
    ).toEqual(["todo", "asset", "person", "trip", "interaction"]);
    await change("type", "person");
    expect(control("firstName").value).toBe("");
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "first name",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps correction drafts on a stale conflict and offers Open without retrying a create", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: "This task was edited elsewhere. Open it to continue.",
        }),
      }),
    );
    await render();
    await change("title", "Edited draft");
    await click("Save correction");
    expect(control("title").value).toBe("Edited draft");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "edited elsewhere",
    );
    expect(container.querySelector('a[href="/lists/later"]')?.textContent).toBe(
      "Open saved item",
    );
    expect(saved).not.toHaveBeenCalled();
  });
  it("limits Board corrections to title, note and kind", async () => {
    const board = row({
      proposal: null,
      placement: {
        type: "board",
        id: "board",
        title: "Image",
        destination: "Board",
        path: "/board",
      },
      fields: { title: "Image", note: "Keep image", kind: "image" },
      movable: false,
    });
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ review: board }) });
    vi.stubGlobal("fetch", fetcher);
    await render(board);
    expect(container.querySelector('[name="type"]')).toBeNull();
    await change("note", "New note");
    await click("Save correction");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      revision: 4,
      fields: { title: "Image", note: "New note", kind: "image" },
    });
  });
  it("edits Reader metadata and states without source/content controls or a move selector", async () => {
    const reader = row({
      proposal: null,
      placement: {
        type: "reader",
        id: "reader",
        title: "Essay",
        destination: "Read Later",
        path: "/reader/reader",
      },
      fields: {
        title: "Essay",
        byline: "Writer",
        excerpt: "Intro",
        read: false,
        archived: false,
      },
      movable: false,
    });
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ review: reader }) });
    vi.stubGlobal("fetch", fetcher);
    await render(reader);
    expect(container.querySelector('[name="type"]')).toBeNull();
    expect(container.querySelector('[name="url"]')).toBeNull();
    await act(async () => (control("read") as HTMLInputElement).click());
    await click("Save correction");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      revision: 4,
      fields: {
        title: "Essay",
        byline: "Writer",
        excerpt: "Intro",
        read: true,
        archived: false,
      },
    });
  });
  it("edits asset details as labelled fields while preserving other metadata", async () => {
    const asset = row({
      proposal: {
        type: "asset",
        assetKind: "media",
        title: "Book",
        details: {
          creator: "Original writer",
          releaseYear: 2024,
          genres: ["essay", "art"],
        },
      },
      placement: {
        type: "asset",
        id: "asset",
        title: "Book",
        destination: "Media",
        path: "/media",
      },
    });
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ review: asset }) });
    vi.stubGlobal("fetch", fetcher);
    await render(asset);
    expect(container.querySelector('[name="detail-creator"]')).not.toBeNull();
    await change("detail-creator", "New writer");
    await click("Save correction");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).proposal.details).toEqual({
      creator: "New writer",
      releaseYear: 2024,
      genres: ["essay", "art"],
    });
    expect(container.textContent).not.toContain("JSON");
  });
  it("respects backend move restrictions and exposes labelled keyboard controls", async () => {
    await render(row({ movable: false }));
    expect(container.querySelector('[name="type"]')).toBeNull();
    for (const item of container.querySelectorAll("input, select, textarea"))
      expect(item.closest("label")?.textContent?.trim()).toBeTruthy();
    await click("Cancel");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
