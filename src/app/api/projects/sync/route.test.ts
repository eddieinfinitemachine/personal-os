import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), founder: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/cron", () => ({ isFounderUser: mocks.founder }));
vi.mock("@/lib/projects/github", () => ({ syncGithubProjects: mocks.sync }));
import { POST } from "./route";

const req = () => new Request("https://example.invalid/api/projects/sync", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("GITHUB_TOKEN", "synthetic-token");
  mocks.user.mockResolvedValue("founder");
  mocks.founder.mockResolvedValue(true);
  mocks.sync.mockResolvedValue({ scanned: 1, repos: 1, active: 1, ms: 1 });
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

  it("runs the GitHub sync inline for the founder", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith("founder");
  });

  it("400s without GITHUB_TOKEN and 502s when GitHub fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GITHUB_TOKEN", "");
    expect((await POST(req())).status).toBe(400);
    vi.stubEnv("GITHUB_TOKEN", "synthetic-token");
    mocks.sync.mockRejectedValueOnce(new Error("boom"));
    expect((await POST(req())).status).toBe(502);
    spy.mockRestore();
  });
});
