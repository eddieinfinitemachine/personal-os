import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    readerItem: { findFirst: mocks.findFirst },
    highlight: { create: mocks.create, deleteMany: mocks.deleteMany },
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
import { DELETE, GET, POST } from "./route";

const url = "https://example.invalid/api/reader/a1/highlights";
const ctx = { params: Promise.resolve({ id: "a1" }) };
const send = (method: string, body: string) => new Request(url, { method, body });
const first = new Date("2026-11-02T08:00:00Z");
const second = new Date("2026-11-02T09:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("owner");
  mocks.findFirst.mockResolvedValue({
    highlights: [
      { id: "h1", text: "First line", note: null, createdAt: first },
      { id: "h2", text: "Later line", note: "Worth it", createdAt: second },
    ],
  });
  mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "h3", ...data }));
  mocks.deleteMany.mockResolvedValue({ count: 1 });
});

describe("GET /api/reader/[id]/highlights", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(new Request(url), ctx)).status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("404s when the item isn't the caller's", async () => {
    mocks.user.mockResolvedValueOnce("friend");
    mocks.findFirst.mockResolvedValueOnce(null);
    const res = await GET(new Request(url), ctx);
    expect(res.status).toBe(404);
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "a1", userId: "friend" });
  });

  it("lists the item's highlights oldest first", async () => {
    const res = await GET(new Request(url), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      highlights: [
        { id: "h1", text: "First line", note: null, createdAt: first.toISOString() },
        { id: "h2", text: "Later line", note: "Worth it", createdAt: second.toISOString() },
      ],
    });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "a1", userId: "owner" },
      select: {
        highlights: {
          orderBy: { createdAt: "asc" },
          select: { id: true, text: true, note: true, createdAt: true },
        },
      },
    });
  });
});

describe("POST and DELETE /api/reader/[id]/highlights", () => {
  it("400 on malformed JSON instead of throwing", async () => {
    for (const method of ["POST", "DELETE"] as const) {
      const res = await (method === "POST" ? POST : DELETE)(send(method, "{oops"), ctx);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid json" });
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("still saves a trimmed highlight and deletes by id", async () => {
    const res = await POST(send("POST", JSON.stringify({ text: "  A line  ", note: " " })), ctx);
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({
      data: { userId: "owner", itemId: "a1", text: "A line", note: null },
    });
    expect((await DELETE(send("DELETE", JSON.stringify({ highlightId: "h1" })), ctx)).status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: "h1", userId: "owner", itemId: "a1" } });
  });

  it("400s on a missing or non-string text / highlightId", async () => {
    expect((await POST(send("POST", JSON.stringify({ text: 5 })), ctx)).status).toBe(400);
    expect((await POST(send("POST", "null"), ctx)).status).toBe(400);
    expect((await DELETE(send("DELETE", JSON.stringify({})), ctx)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
