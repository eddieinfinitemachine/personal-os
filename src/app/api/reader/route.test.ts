import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  bearer: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUser: vi.fn(),
  replay: vi.fn(),
  meta: vi.fn(),
  review: vi.fn(),
  extract: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.session }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: mocks.bearer }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    readerItem: { findMany: mocks.findMany, findFirst: mocks.findFirst },
    user: { findUnique: mocks.findUser },
  },
}));
vi.mock("@/lib/reader-extract", () => ({ extractArticle: mocks.extract, extractArticleFromHtml: mocks.extract }));
vi.mock("@/lib/capture-review/record", () => ({
  findCaptureReplay: mocks.replay,
  quickSource: (value: unknown) => value,
  withCaptureReview: mocks.review,
}));
vi.mock("@/lib/capture-review/intake", () => ({ intakeMeta: mocks.meta }));
vi.mock("@/lib/kindle-send", () => ({ sendReaderItemToKindle: vi.fn() }));
import { GET } from "./route";

const base = "https://example.invalid/api/reader";
const savedAt = new Date("2026-11-01T10:00:00Z");
const sentAt = new Date("2026-11-02T10:00:00Z");
const listRow = (over: Record<string, unknown>) => ({
  id: "a1",
  url: "https://example.com/a",
  title: "A",
  byline: null,
  siteName: "Example",
  excerpt: "Gist",
  imageUrl: null,
  wordCount: 460,
  savedAt,
  readAt: null,
  archivedAt: null,
  kindleSentAt: null,
  kindleError: null,
  _count: { highlights: 2 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue("owner");
  mocks.bearer.mockResolvedValue(null);
  mocks.findMany.mockResolvedValue([
    listRow({}),
    listRow({ id: "a2", wordCount: 50, kindleSentAt: sentAt }),
    listRow({ id: "a3", kindleError: "bounced" }),
  ]);
  mocks.findUser.mockResolvedValue({ kindleEmail: null, kindleAutoSend: true });
});

describe("GET /api/reader (list)", () => {
  it("401s without a session", async () => {
    mocks.session.mockResolvedValueOnce(null);
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("keeps the old fields and adds archive, Kindle and reading-time fields", async () => {
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.kindle).toEqual({ configured: false, autoSend: true });
    expect(body.items[0]).toEqual({
      id: "a1",
      url: "https://example.com/a",
      title: "A",
      byline: null,
      siteName: "Example",
      excerpt: "Gist",
      imageUrl: null,
      wordCount: 460,
      minutes: 2,
      savedAt: savedAt.toISOString(),
      readAt: null,
      archivedAt: null,
      kindleSentAt: null,
      kindleError: null,
      kindleStatus: "none",
      _count: { highlights: 2 },
    });
    expect(body.items[1]).toMatchObject({ minutes: 1, kindleSentAt: sentAt.toISOString(), kindleStatus: "sent" });
    expect(body.items[2]).toMatchObject({ kindleError: "bounced", kindleStatus: "failed" });
    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ userId: "owner", archivedAt: null });
    expect(query.select).toMatchObject({ archivedAt: true, kindleSentAt: true, kindleError: true });
    expect(mocks.findUser).toHaveBeenCalledWith({
      where: { id: "owner" },
      select: { kindleEmail: true, kindleAutoSend: true },
    });
  });

  it("?archived=1 lists only archived items", async () => {
    mocks.findUser.mockResolvedValueOnce({ kindleEmail: "me@kindle.com", kindleAutoSend: false });
    const body = await (await GET(new Request(`${base}?archived=1`))).json();
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ userId: "owner", archivedAt: { not: null } });
    expect(body.kindle).toEqual({ configured: true, autoSend: false });
  });
});

describe("GET /api/reader?url= (save)", () => {
  it("still saves instead of listing", async () => {
    mocks.meta.mockReturnValue({ id: "rev1", requestHash: "hash" });
    mocks.replay.mockResolvedValue({ placement: { id: "a1" } });
    mocks.findFirst.mockResolvedValue({ id: "a1", title: "A", wordCount: 460, kindleSentAt: null, contentHtml: "<p>x</p>" });
    const res = await GET(new Request(`${base}?url=${encodeURIComponent("https://example.com/a")}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      id: "a1",
      title: "A",
      minutes: 2,
      kindle: "off",
      message: "Already saved",
      reviewId: "rev1",
    });
    expect(mocks.meta.mock.calls[0][2]).toBe("reader");
    expect(mocks.meta.mock.calls[0][3]).toMatchObject({ url: "https://example.com/a" });
    expect(mocks.replay).toHaveBeenCalledWith("owner", "rev1", "hash");
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "a1", userId: "owner" } });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("falls back to the capture bearer when there is no session", async () => {
    mocks.session.mockResolvedValue(null);
    mocks.bearer.mockResolvedValueOnce(null);
    const res = await GET(new Request(`${base}?url=https://example.com/a`));
    expect(res.status).toBe(401);
    expect(mocks.bearer).toHaveBeenCalledTimes(1);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
