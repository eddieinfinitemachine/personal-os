import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted before any import: no test here may reach the real database.
type Row = { id: string; userId: string; url: string; title: string; savedAt: Date; archivedAt: Date | null; contentHtml: string };
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  session: vi.fn(),
  userFindUnique: vi.fn(),
  findMany: vi.fn(),
  extract: vi.fn(),
  withReview: vi.fn(),
  created: [] as unknown[],
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    readerItem: { findMany: db.findMany },
    user: { findUnique: db.userFindUnique },
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: db.session }));
vi.mock("@/lib/reader-extract", () => ({ extractArticle: db.extract, extractArticleFromHtml: vi.fn() }));
vi.mock("@/lib/capture-review/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/capture-review/record")>()),
  findCaptureReplay: vi.fn(async () => null),
  withCaptureReview: db.withReview,
}));
vi.mock("@/lib/kindle-send", () => ({ sendReaderItemToKindle: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }));

import { GET } from "@/app/api/reader/route";

const TOKEN = "test-capture-token";
const FOUNDER = "founder@example.com";

// A small model of the Prisma query the list makes: user and archive filter,
// the keyset `OR`, (savedAt desc, id desc) order and `take`.
type Where = { userId: string; archivedAt: null | { not: null }; OR?: [{ savedAt: { lt: Date } }, { savedAt: Date; id: { lt: string } }] };
function list({ where, take }: { where: Where; take: number }) {
  return db.rows
    .filter((r) => r.userId === where.userId)
    .filter((r) => (where.archivedAt === null ? r.archivedAt === null : r.archivedAt !== null))
    .filter((r) => {
      if (!where.OR) return true;
      const [older, tie] = where.OR;
      return r.savedAt < older.savedAt.lt || (r.savedAt.getTime() === tie.savedAt.getTime() && r.id < tie.id.lt);
    })
    .sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime() || (a.id < b.id ? 1 : -1))
    .slice(0, take)
    .map(({ id, url, title, savedAt }) => ({ id, url, title, savedAt, _count: { highlights: 0 } }));
}

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 1, 12, minutes));
const request = (query = "", headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
  new Request(`https://example.com/api/reader${query}`, { headers });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CAPTURE_TOKEN", TOKEN);
  vi.stubEnv("FOUNDER_EMAIL", FOUNDER);
  db.session.mockResolvedValue(null);
  db.userFindUnique.mockImplementation(async ({ where }: { where: { email?: string; id?: string } }) =>
    where.email === FOUNDER ? { id: "owner" } : where.id ? { kindleEmail: null, kindleAutoSend: false } : null,
  );
  db.findMany.mockImplementation(async (args: { where: Where; take: number }) => list(args));
  db.rows = [
    { id: "a", userId: "owner", url: "https://x.test/a", title: "A", savedAt: at(1), archivedAt: null, contentHtml: "" },
    { id: "b", userId: "owner", url: "https://x.test/b", title: "B", savedAt: at(3), archivedAt: null, contentHtml: "" },
    { id: "c", userId: "owner", url: "https://x.test/c", title: "C", savedAt: at(3), archivedAt: null, contentHtml: "" },
    { id: "d", userId: "owner", url: "https://x.test/d", title: "D", savedAt: at(5), archivedAt: null, contentHtml: "" },
    { id: "e", userId: "owner", url: "https://x.test/e", title: "E", savedAt: at(6), archivedAt: at(7), contentHtml: "" },
    { id: "z", userId: "someone-else", url: "https://x.test/z", title: "Z", savedAt: at(9), archivedAt: null, contentHtml: "" },
  ];
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/reader (list)", () => {
  it("lists the token owner's unarchived items, newest first", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["d", "c", "b", "a"]);
    expect(body.nextCursor).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts the token as ?token= too, and still accepts a session", async () => {
    expect((await GET(request(`?token=${TOKEN}`, {}))).status).toBe(200);
    db.session.mockResolvedValue("owner");
    expect((await GET(request("", {}))).status).toBe(200);
  });

  it("rejects a missing or wrong token", async () => {
    expect((await GET(request("", {}))).status).toBe(401);
    expect((await GET(request("", { authorization: "Bearer wrong" }))).status).toBe(401);
    expect(db.findMany).not.toHaveBeenCalled();
  });

  it("pages with limit and cursor without skipping or repeating tied items", async () => {
    const first = await (await GET(request("?limit=2"))).json();
    expect(first.items.map((i: { id: string }) => i.id)).toEqual(["d", "c"]);
    expect(typeof first.nextCursor).toBe("string");
    const second = await (await GET(request(`?limit=2&cursor=${first.nextCursor}`))).json();
    expect(second.items.map((i: { id: string }) => i.id)).toEqual(["b", "a"]);
    expect(second.nextCursor).toBeNull();
  });

  it("lists archived items with archived=1", async () => {
    const body = await (await GET(request("?archived=1"))).json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["e"]);
  });

  it("refuses a bad limit or cursor", async () => {
    expect((await GET(request("?limit=0"))).status).toBe(400);
    expect((await GET(request("?limit=201"))).status).toBe(400);
    expect((await GET(request("?limit=abc"))).status).toBe(400);
    expect((await GET(request("?cursor=not-a-cursor"))).status).toBe(400);
  });
});

describe("GET /api/reader?url= (Shortcut save)", () => {
  it("still saves the link instead of listing", async () => {
    const item = { id: "new", title: "Saved", wordCount: 460, contentHtml: "<p>x</p>", kindleSentAt: null };
    db.extract.mockResolvedValue({ title: "Saved", byline: null, siteName: null, excerpt: null, imageUrl: null, contentHtml: "<p>x</p>", wordCount: 460 });
    db.withReview.mockImplementation(async (_meta: unknown, handlers: { commit: (tx: unknown) => Promise<{ value: unknown }> }) => {
      const tx = {
        readerItem: {
          findFirst: vi.fn(async () => null),
          create: vi.fn(async (args: unknown) => { db.created.push(args); return item; }),
        },
      };
      const { value } = await handlers.commit(tx);
      return { value, created: true, reviewId: "review-1" };
    });
    const res = await GET(request(`?url=${encodeURIComponent("https://site.test/post")}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, id: "new", message: "Saved · 2 min" });
    expect(db.extract).toHaveBeenCalledWith("https://site.test/post");
    expect(db.created).toEqual([expect.objectContaining({ data: expect.objectContaining({ userId: "owner", url: "https://site.test/post" }) })]);
    expect(db.findMany).not.toHaveBeenCalled();
  });
});
