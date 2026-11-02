import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  founder: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { improvement: { findMany: mocks.findMany, create: mocks.create } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/cron", () => ({ isFounderUser: mocks.founder }));
import { GET, POST } from "./route";
import { MAX_REQUEST_CHARS } from "@/lib/improvements/request";

const url = "https://example.invalid/api/improvements";
const post = (body: unknown) =>
  new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const created = new Date("2026-11-02T12:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  request: "Focus the search box when I open Home",
  context: null,
  status: "queued",
  summary: null,
  reviewReason: null,
  prUrl: null,
  previewUrl: null,
  error: null,
  createdAt: created,
  completedAt: null,
  ...over,
});
const context = {
  path: "/board",
  title: "Board",
  viewport: { width: 1440, height: 900 },
  version: "1.2.3",
  userAgent: "Mozilla/5.0",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("founder");
  mocks.founder.mockResolvedValue(true);
  mocks.findMany.mockResolvedValue([]);
  mocks.create.mockImplementation(async ({ data }) => row({ ...data, context: data.context === Prisma.DbNull ? null : data.context }));
});

describe("GET /api/improvements", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(new Request(url))).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lists the caller's 20 most recent requests, newest first, with ISO dates", async () => {
    mocks.user.mockResolvedValueOnce("someone");
    mocks.findMany.mockResolvedValueOnce([row({ status: "shipped", summary: "Done.", completedAt: created, context })]);
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "someone" });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.take).toBe(20);
    expect(args.select.branch).toBeUndefined();
    expect(args.select.mergedSha).toBeUndefined();
    const body = await res.json();
    expect(body.improvements).toHaveLength(1);
    expect(body.improvements[0]).toMatchObject({
      id: "i1",
      status: "shipped",
      summary: "Done.",
      context,
      createdAt: created.toISOString(),
      completedAt: created.toISOString(),
    });
  });
});

describe("POST /api/improvements", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(post({ request: "x" }))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("403s for anyone but the founder (the worker runs with full permissions)", async () => {
    mocks.user.mockResolvedValueOnce("friend");
    mocks.founder.mockResolvedValueOnce(false);
    const res = await POST(post({ request: "x" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Improvements aren't enabled for this account.");
    expect(mocks.founder).toHaveBeenCalledWith("friend");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("400s on a missing, blank, non-string or oversized request, or bad JSON", async () => {
    for (const body of [{}, { request: "" }, { request: "  \n" }, { request: 42 }, { request: "x".repeat(MAX_REQUEST_CHARS + 1) }, "not json", null]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("queues a trimmed request with its cleaned context", async () => {
    const res = await POST(post({ request: "  Show due dates on Board cards \n", context: { ...context, extra: "dropped" } }));
    expect(res.status).toBe(200);
    const { data, select } = mocks.create.mock.calls[0][0];
    expect(data).toEqual({ userId: "founder", request: "Show due dates on Board cards", context, status: "queued" });
    expect(select.id).toBe(true);
    const body = await res.json();
    expect(body.improvement).toMatchObject({
      request: "Show due dates on Board cards",
      status: "queued",
      context,
      createdAt: created.toISOString(),
    });
  });

  it("stores JSON null when no usable context came with the request", async () => {
    const res = await POST(post({ request: "Tidy the footer", context: { path: "not-a-path" } }));
    expect(res.status).toBe(200);
    expect(mocks.create.mock.calls[0][0].data.context).toBe(Prisma.DbNull);
    expect((await res.json()).improvement.context).toBeNull();
  });
});
