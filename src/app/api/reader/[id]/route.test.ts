import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  findUser: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    readerItem: { findFirst: mocks.findFirst, update: mocks.update },
    user: { findUnique: mocks.findUser },
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
import { GET, PATCH } from "./route";

const url = "https://example.invalid/api/reader/a1";
const ctx = { params: Promise.resolve({ id: "a1" }) };
const patch = (body: string) => new Request(url, { method: "PATCH", body });
const savedAt = new Date("2026-11-01T10:00:00Z");
const first = new Date("2026-11-02T08:00:00Z");
const second = new Date("2026-11-02T09:30:00Z");
// What Prisma returns for the route's select (highlights already in createdAt order).
const row = {
  id: "a1",
  url: "https://example.com/essay",
  title: "An essay",
  byline: "A. Writer",
  siteName: "Example",
  excerpt: "The gist.",
  imageUrl: "https://example.com/cover.jpg",
  contentHtml: "<p>Body</p>",
  wordCount: 1000,
  savedAt,
  readAt: null,
  archivedAt: null,
  kindleSentAt: null,
  kindleError: "sending",
  highlights: [
    { id: "h1", text: "First line", note: null, createdAt: first },
    { id: "h2", text: "Later line", note: "Worth it", createdAt: second },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("owner");
  mocks.findFirst.mockResolvedValue(row);
  mocks.findUser.mockResolvedValue({ kindleEmail: "me@kindle.com", kindleAutoSend: false });
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "a1",
    readAt: null,
    archivedAt: null,
    ...data,
  }));
});

describe("GET /api/reader/[id]", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    const res = await GET(new Request(url), ctx);
    expect(res.status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("404s for another user's item", async () => {
    mocks.user.mockResolvedValueOnce("friend");
    mocks.findFirst.mockResolvedValueOnce(null);
    const res = await GET(new Request(url), ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "a1", userId: "friend" });
  });

  it("returns the article, its highlights oldest first, and the Kindle setup", async () => {
    const res = await GET(new Request(url), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      item: {
        id: "a1",
        url: "https://example.com/essay",
        title: "An essay",
        byline: "A. Writer",
        siteName: "Example",
        excerpt: "The gist.",
        imageUrl: "https://example.com/cover.jpg",
        contentHtml: "<p>Body</p>",
        wordCount: 1000,
        minutes: 4,
        savedAt: savedAt.toISOString(),
        readAt: null,
        archivedAt: null,
        kindleSentAt: null,
        kindleError: "sending",
        kindleStatus: "sending",
        highlights: [
          { id: "h1", text: "First line", note: null, createdAt: first.toISOString() },
          { id: "h2", text: "Later line", note: "Worth it", createdAt: second.toISOString() },
        ],
      },
      kindle: { configured: true, autoSend: false },
    });
    const query = mocks.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: "a1", userId: "owner" });
    expect(query.select.highlights).toEqual({
      orderBy: { createdAt: "asc" },
      select: { id: true, text: true, note: true, createdAt: true },
    });
    expect(query.select).not.toHaveProperty("userId");
    expect(mocks.findUser).toHaveBeenCalledWith({
      where: { id: "owner" },
      select: { kindleEmail: true, kindleAutoSend: true },
    });
  });

  it("reports Kindle unconfigured without an address, and floors minutes at 1", async () => {
    const sentAt = new Date("2026-11-03T07:00:00Z");
    mocks.findFirst.mockResolvedValueOnce({ ...row, wordCount: 0, kindleSentAt: sentAt, kindleError: null, highlights: [] });
    mocks.findUser.mockResolvedValueOnce({ kindleEmail: null, kindleAutoSend: true });
    const { item, kindle } = await (await GET(new Request(url), ctx)).json();
    expect(kindle).toEqual({ configured: false, autoSend: true });
    expect(item).toMatchObject({ minutes: 1, kindleSentAt: sentAt.toISOString(), kindleStatus: "sent", highlights: [] });
  });

  it("marks a stored error as failed", async () => {
    mocks.findFirst.mockResolvedValueOnce({ ...row, kindleError: "Resend rejected the address" });
    const { item } = await (await GET(new Request(url), ctx)).json();
    expect(item.kindleStatus).toBe("failed");
    expect(item.kindleError).toBe("Resend rejected the address");
  });
});

describe("PATCH /api/reader/[id]", () => {
  it("400s on malformed JSON instead of throwing", async () => {
    const res = await PATCH(patch("{read: tru"), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("still archives and marks read", async () => {
    const res = await PATCH(patch(JSON.stringify({ read: true, archived: true })), ctx);
    expect(res.status).toBe(200);
    const { data } = mocks.update.mock.calls[0][0];
    expect(data.readAt).toBeInstanceOf(Date);
    expect(data.archivedAt).toBeInstanceOf(Date);
  });

  it("404s for another user's item before reading the body", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    expect((await PATCH(patch("not json"), ctx)).status).toBe(404);
  });
});
