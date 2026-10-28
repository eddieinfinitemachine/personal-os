// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_MS, ResearchGrid } from "./research-grid";
import type { ResearchReportView } from "@/lib/research/report";

const report = (over: Partial<ResearchReportView> = {}): ResearchReportView => ({
  id: "r1",
  title: "Shaker furniture",
  topic: "Shaker furniture",
  status: "ready",
  summary: "Plain, useful, built to last.",
  pdfUrl: "https://blob.example.invalid/r1.pdf",
  pageCount: 14,
  error: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  completedAt: "2026-10-20T12:40:00.000Z",
  ...over,
});
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
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
const render = (reports: ResearchReportView[], canCreate = true) =>
  act(async () => root.render(<ResearchGrid initialReports={reports} canCreate={canCreate} />));
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;

describe("research grid", () => {
  it("links ready reports to the PDF in a new tab and shows failures with their error", async () => {
    await render([report(), report({ id: "r2", title: "Broken", status: "failed", pdfUrl: null, pageCount: null, summary: null, error: "Timed out after 45 minutes." })]);
    const link = container.querySelector('a[href="https://blob.example.invalid/r1.pdf"]')!;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.textContent).toContain("14 pages");
    expect(link.textContent).toContain("Plain, useful, built to last.");
    const failed = container.querySelector('[data-report="r2"]')!;
    expect(failed.querySelector("a")).toBeNull();
    expect(failed.textContent).toContain("Failed");
    expect(failed.querySelector("details")!.textContent).toContain("Timed out after 45 minutes.");
  });

  it("queues a report optimistically, then swaps in the saved row and polls until it is done", async () => {
    const saved = report({ id: "r9", title: "Kyoto gardens", topic: "Kyoto gardens", status: "queued", pdfUrl: null, summary: null, pageCount: null, completedAt: null });
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ report: saved }))
      .mockResolvedValueOnce(response({ reports: [{ ...saved, status: "ready", pdfUrl: "https://blob.example.invalid/r9.pdf", pageCount: 12 }] }));
    vi.stubGlobal("fetch", fetch);
    await render([]);
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "  Kyoto gardens ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("New report").click());
    expect(fetch.mock.calls[0][0]).toBe("/api/research");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ topic: "Kyoto gardens" });
    expect(container.querySelector('[data-report="r9"]')!.textContent).toContain("Queued");
    expect(textarea.value).toBe("");

    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(fetch.mock.calls[1][0]).toBe("/api/research");
    expect(container.querySelector('a[href="https://blob.example.invalid/r9.pdf"]')).not.toBeNull();

    // Nothing active any more: no further polling.
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 2); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("restores the topic and shows the error when queueing fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Research reports aren't enabled for this account." }, 403)));
    await render([]);
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Kyoto gardens");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("New report").click());
    expect(container.querySelector("[data-report]")).toBeNull();
    expect(textarea.value).toBe("Kyoto gardens");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("aren't enabled");
  });

  it("hides the composer when the account can't create reports", async () => {
    await render([], false);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("isn't enabled for this account");
  });

  it("deletes a report after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetch = vi.fn().mockResolvedValue(response({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await render([report()]);
    await act(async () => (container.querySelector('button[aria-label="Delete Shaker furniture"]') as HTMLButtonElement).click());
    expect(fetch).toHaveBeenCalledWith("/api/research/r1", { method: "DELETE" });
    expect(container.querySelector('[data-report="r1"]')).toBeNull();
  });
});
