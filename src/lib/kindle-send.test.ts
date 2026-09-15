import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  renderKindleEpub: vi.fn(),
  sendKindleEmail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    readerItem: {
      findUnique: mocks.findUnique,
      count: mocks.count,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/kindle", () => ({
  renderKindleEpub: mocks.renderKindleEpub,
}));

vi.mock("@/lib/email", () => ({
  sendKindleEmail: mocks.sendKindleEmail,
}));

import {
  KINDLE_DAILY_LIMIT,
  sendReaderItemToKindle,
} from "@/lib/kindle-send";
import { KINDLE_SENDING } from "@/lib/kindle-status";

function readerItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    userId: "user-1",
    url: "https://example.com/article",
    title: "Example article",
    byline: "Example Author",
    siteName: "Example",
    imageUrl: null,
    contentHtml: "<p>Article text</p>",
    savedAt: new Date("2026-09-15T12:00:00.000Z"),
    kindleSentAt: null,
    kindleError: null,
    user: {
      id: "user-1",
      kindleEmail: "reader@kindle.com",
    },
    ...overrides,
  };
}

describe("sendReaderItemToKindle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(readerItem());
    mocks.count.mockResolvedValue(0);
    mocks.update.mockResolvedValue({});
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.renderKindleEpub.mockResolvedValue({
      buffer: Buffer.from("epub"),
      filename: "Example article.epub",
      images: { kept: 0, dropped: 0, converted: 0 },
    });
    mocks.sendKindleEmail.mockResolvedValue({ id: "resend-1" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns 404 when the item does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(sendReaderItemToKindle("missing")).resolves.toEqual({
      ok: false,
      status: 404,
      error: "Not found",
    });
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("returns 404 when the item belongs to another user", async () => {
    const result = await sendReaderItemToKindle("item-1", {
      userId: "user-2",
    });

    expect(result).toEqual({ ok: false, status: 404, error: "Not found" });
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("requires a configured Kindle email", async () => {
    mocks.findUnique.mockResolvedValue(
      readerItem({
        user: { id: "user-1", kindleEmail: null },
      }),
    );

    const result = await sendReaderItemToKindle("item-1");

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Add your Kindle email in Settings first.",
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects empty article content and stores the error", async () => {
    mocks.findUnique.mockResolvedValue(readerItem({ contentHtml: "" }));

    const result = await sendReaderItemToKindle("item-1");

    expect(result).toEqual({
      ok: false,
      status: 422,
      error: "No article text to send.",
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { kindleError: "No article text to send." },
    });
  });

  it("returns an existing send without sending again", async () => {
    const sentAt = new Date("2026-09-14T12:00:00.000Z");
    mocks.findUnique.mockResolvedValue(readerItem({ kindleSentAt: sentAt }));

    const result = await sendReaderItemToKindle("item-1");

    expect(result).toEqual({ ok: true, sentAt, resendId: null });
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.renderKindleEpub).not.toHaveBeenCalled();
  });

  it("enforces the daily send cap and stores the error", async () => {
    mocks.count.mockResolvedValue(KINDLE_DAILY_LIMIT);

    const result = await sendReaderItemToKindle("item-1");

    expect(result).toEqual({
      ok: false,
      status: 429,
      error: "Daily Kindle limit reached (30 in 24 hours).",
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: {
        kindleError: "Daily Kindle limit reached (30 in 24 hours).",
      },
    });
    expect(mocks.renderKindleEpub).not.toHaveBeenCalled();
  });

  it("claims non-force sends with a null-safe sending guard", async () => {
    await sendReaderItemToKindle("item-1");

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "item-1",
        kindleSentAt: null,
        OR: [
          { kindleError: null },
          { NOT: { kindleError: KINDLE_SENDING } },
        ],
      },
      data: { kindleError: KINDLE_SENDING },
    });
  });

  it("returns 409 when another non-force send owns the claim", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const result = await sendReaderItemToKindle("item-1");

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Already sending.",
    });
    expect(mocks.renderKindleEpub).not.toHaveBeenCalled();
  });

  it("force-sends an item stuck in the persisted sending state", async () => {
    mocks.findUnique.mockResolvedValue(
      readerItem({ kindleError: KINDLE_SENDING }),
    );

    const result = await sendReaderItemToKindle("item-1", {
      force: true,
      userId: "user-1",
    });

    expect(result.ok).toBe(true);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenNthCalledWith(1, {
      where: { id: "item-1" },
      data: { kindleError: KINDLE_SENDING },
    });
    expect(mocks.renderKindleEpub).toHaveBeenCalledOnce();
  });

  it("persists and returns the same sentAt on success", async () => {
    const now = new Date("2026-09-15T15:30:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = await sendReaderItemToKindle("item-1");

    expect(result).toEqual({ ok: true, sentAt: now, resendId: "resend-1" });
    expect(mocks.sendKindleEmail).toHaveBeenCalledWith({
      to: "reader@kindle.com",
      title: "Example article",
      filename: "Example article.epub",
      epub: Buffer.from("epub"),
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { kindleSentAt: now, kindleError: null },
    });
  });

  it("stores and returns an email delivery failure", async () => {
    mocks.sendKindleEmail.mockRejectedValue(new Error("Resend unavailable"));

    const result = await sendReaderItemToKindle("item-1");

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: "Resend unavailable",
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { kindleError: "Resend unavailable" },
    });
    expect(console.warn).toHaveBeenCalledWith("[kindle] failed", {
      itemId: "item-1",
      error: "Resend unavailable",
    });
  });
});
