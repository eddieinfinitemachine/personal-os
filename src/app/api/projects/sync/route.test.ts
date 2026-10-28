import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), founder: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/cron", () => ({ isFounderUser: mocks.founder }));
vi.mock("@/lib/projects/sync", () => ({ syncInferredProjects: mocks.sync }));
import { POST } from "./route";

const req = () => new Request("https://example.invalid/api/projects/sync", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("founder");
  mocks.founder.mockResolvedValue(true);
  mocks.sync.mockResolvedValue({ status: "ok", projects: 7, ms: 1 });
});

describe("POST /api/projects/sync", () => {
  it("404s for anyone but the founder", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(req())).status).toBe(404);
    mocks.user.mockResolvedValue("friend");
    mocks.founder.mockResolvedValue(false);
    expect((await POST(req())).status).toBe(404);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("runs the inference inline for the founder", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", projects: 7 });
    expect(mocks.sync).toHaveBeenCalledWith("founder");
  });

  it("409s while another run holds the lock and 502s with the failure class", async () => {
    mocks.sync.mockResolvedValueOnce({ status: "busy" });
    expect((await POST(req())).status).toBe(409);
    mocks.sync.mockResolvedValueOnce({ status: "failed", error: "gmail: HTTP 429", ms: 3 });
    const res = await POST(req());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Refresh failed (gmail: HTTP 429)" });
  });
});
