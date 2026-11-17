import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted before any import: no test here may reach the real database.
type Row = { id: string; userId: string; url: string; title: string; contentHtml: string; readAt: Date | null; archivedAt: Date | null };
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  session: vi.fn(),
  userFindUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    readerItem: { findFirst: db.findFirst, update: db.update, delete: db.remove },
    user: { findUnique: db.userFindUnique },
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: db.session }));

import { DELETE, GET, PATCH } from "@/app/api/reader/[id]/route";

const TOKEN = "test-capture-token";
const FOUNDER = "founder@example.com";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (id: string, init: RequestInit = {}, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
  new Request(`https://example.com/api/reader/${id}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CAPTURE_TOKEN", TOKEN);
  vi.stubEnv("FOUNDER_EMAIL", FOUNDER);
  db.session.mockResolvedValue(null);
  db.userFindUnique.mockImplementation(async ({ where }: { where: { email: string } }) => (where.email === FOUNDER ? { id: "owner" } : null));
  db.rows = [
    { id: "mine", userId: "owner", url: "https://site.test/posts/one", title: "One", contentHtml: '<h2>Hi</h2><p><a href="/two">Two</a></p>', readAt: null, archivedAt: null },
    { id: "empty", userId: "owner", url: "https://site.test/three", title: "Three", contentHtml: "", readAt: null, archivedAt: null },
    { id: "theirs", userId: "someone-else", url: "https://site.test/z", title: "Z", contentHtml: "<p>z</p>", readAt: null, archivedAt: null },
  ];
  db.findFirst.mockImplementation(async ({ where, select }: { where: { id: string; userId: string }; select?: Record<string, boolean> }) => {
    const row = db.rows.find((r) => r.id === where.id && r.userId === where.userId);
    if (!row || !select) return row ?? null;
    return Object.fromEntries(Object.keys(select).map((key) => [key, (row as Record<string, unknown>)[key] ?? null]));
  });
  db.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => ({ ...db.rows.find((r) => r.id === where.id)!, ...data }));
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/reader/[id]", () => {
  it("returns the item with its article as Markdown for the token", async () => {
    const res = await GET(request("mine"), params("mine"));
    expect(res.status).toBe(200);
    const { item } = await res.json();
    expect(item).toMatchObject({ id: "mine", url: "https://site.test/posts/one", title: "One", archivedAt: null });
    expect(item.markdown).toBe("## Hi\n\n[Two](https://site.test/two)");
    expect(db.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "mine", userId: "owner" } }));
  });

  it("returns an empty markdown string when extraction failed", async () => {
    const { item } = await (await GET(request("empty"), params("empty"))).json();
    expect(item.markdown).toBe("");
  });

  it("rejects a missing or wrong token", async () => {
    expect((await GET(request("mine", {}, {}), params("mine"))).status).toBe(401);
    expect((await GET(request("mine", {}, { authorization: "Bearer nope" }), params("mine"))).status).toBe(401);
    expect(db.findFirst).not.toHaveBeenCalled();
  });

  it("answers 404 for another user's item", async () => {
    expect((await GET(request("theirs"), params("theirs"))).status).toBe(404);
  });

  it("still serves a session", async () => {
    db.session.mockResolvedValue("owner");
    expect((await GET(request("mine", {}, {}), params("mine"))).status).toBe(200);
  });
});

describe("PATCH /api/reader/[id]", () => {
  const patch = (id: string, body: unknown, headers?: Record<string, string>) =>
    PATCH(request(id, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }, headers), params(id));

  it("archives with the token", async () => {
    const res = await patch("mine", { archived: true });
    expect(res.status).toBe(200);
    const { item } = await res.json();
    expect(item.id).toBe("mine");
    expect(item.archivedAt).not.toBeNull();
    expect(db.update).toHaveBeenCalledWith({ where: { id: "mine" }, data: { archivedAt: expect.any(Date) } });
  });

  it("rejects a missing or wrong token, another user's item and bad JSON", async () => {
    expect((await patch("mine", { read: true }, {})).status).toBe(401);
    expect((await patch("mine", { read: true }, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await patch("theirs", { read: true })).status).toBe(404);
    expect((await patch("mine", "{not json")).status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/reader/[id]", () => {
  it("stays session-only", async () => {
    expect((await DELETE(request("mine", { method: "DELETE" }), params("mine"))).status).toBe(401);
    expect(db.remove).not.toHaveBeenCalled();
  });
});
