import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ founder: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cron", async (orig) => ({ ...(await orig<typeof import("@/lib/cron")>()), getFounderUser: mocks.founder }));
vi.mock("@/lib/projects/github", () => ({ syncGithubProjects: mocks.sync }));
import { GET } from "./route";

const req = (auth?: string) =>
  new Request("https://example.invalid/api/cron/projects-github", auth ? { headers: { authorization: auth } } : {});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("GITHUB_TOKEN", "synthetic-token");
  mocks.founder.mockResolvedValue({ id: "founder", email: "e@x.com" });
  mocks.sync.mockResolvedValue({ scanned: 3, repos: 2, active: 1, ms: 5 });
});

describe("GET /api/cron/projects-github", () => {
  it("requires the cron secret in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
  });

  it("skips cleanly without GITHUB_TOKEN", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const res = await GET(req());
    expect(await res.json()).toEqual({ skipped: "GITHUB_TOKEN not set" });
    expect(mocks.founder).not.toHaveBeenCalled();
  });

  it("syncs for the founder and returns the counts", async () => {
    const res = await GET(req());
    expect(await res.json()).toEqual({ scanned: 3, repos: 2, active: 1, ms: 5 });
    expect(mocks.sync).toHaveBeenCalledWith("founder");
  });

  it("404s without a founder and 502s when GitHub fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.founder.mockResolvedValueOnce(null);
    expect((await GET(req())).status).toBe(404);
    mocks.sync.mockRejectedValueOnce(Object.assign(new Error("GitHub GraphQL 502"), { status: 502 }));
    expect((await GET(req())).status).toBe(502);
    spy.mockRestore();
  });
});
