import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  founder: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { researchReport: { findMany: mocks.findMany, create: mocks.create } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/cron", () => ({ isFounderUser: mocks.founder }));
import { GET, POST } from "./route";
import { MAX_TOPIC_CHARS } from "@/lib/research/report";

const url = "https://example.invalid/api/research";
const post = (body: unknown) =>
  new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const created = new Date("2026-10-27T12:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  title: "Shaker furniture",
  topic: "Shaker furniture",
  status: "queued",
  summary: null,
  pdfUrl: null,
  pageCount: null,
  error: null,
  createdAt: created,
  completedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("founder");
  mocks.founder.mockResolvedValue(true);
  mocks.findMany.mockResolvedValue([]);
  mocks.create.mockImplementation(async ({ data }) => row({ ...data }));
});

describe("GET /api/research", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(new Request(url))).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lists only the caller's reports, newest first, with ISO dates", async () => {
    mocks.user.mockResolvedValueOnce("someone");
    mocks.findMany.mockResolvedValueOnce([row({ status: "ready", completedAt: created })]);
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "someone" });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.select.sourcesJson).toBeUndefined();
    const body = await res.json();
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]).toMatchObject({ id: "r1", status: "ready", createdAt: created.toISOString(), completedAt: created.toISOString() });
  });
});

describe("POST /api/research", () => {
  it("401s without a user", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(post({ topic: "x" }))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("403s for anyone but the founder (the worker runs with full permissions)", async () => {
    mocks.user.mockResolvedValueOnce("friend");
    mocks.founder.mockResolvedValueOnce(false);
    expect((await POST(post({ topic: "x" }))).status).toBe(403);
    expect(mocks.founder).toHaveBeenCalledWith("friend");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("400s on a missing, blank, non-string or oversized topic, or bad JSON", async () => {
    for (const body of [{}, { topic: "" }, { topic: "   \n" }, { topic: 42 }, { topic: "x".repeat(MAX_TOPIC_CHARS + 1) }, "not json", null]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("queues a report with a trimmed topic and a one-line title of at most 80 chars", async () => {
    const topic = `  The history of the Shaker\n\nmovement and its furniture, from Mount Lebanon to the modern revival in Scandinavian design  `;
    const res = await POST(post({ topic }));
    expect(res.status).toBe(200);
    const { data } = mocks.create.mock.calls[0][0];
    expect(data.userId).toBe("founder");
    expect(data.status).toBe("queued");
    expect(data.topic).toBe(topic.trim());
    expect(data.title.length).toBeLessThanOrEqual(80);
    expect(data.title).not.toContain("\n");
    expect(data.title.startsWith("The history of the Shaker movement")).toBe(true);
    expect(data.title.endsWith("…")).toBe(true);
    const body = await res.json();
    expect(body.report).toMatchObject({ status: "queued", createdAt: created.toISOString() });
  });

  it("keeps short topics as the title unchanged", async () => {
    await POST(post({ topic: "Kyoto gardens" }));
    expect(mocks.create.mock.calls[0][0].data.title).toBe("Kyoto gardens");
  });
});
