import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ founder: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cron", async (orig) => ({ ...(await orig<typeof import("@/lib/cron")>()), getFounderUser: mocks.founder }));
vi.mock("@/lib/projects/sync", () => ({ syncInferredProjects: mocks.sync }));
import { GET } from "./route";

const req = (auth?: string) =>
  new Request("https://example.invalid/api/cron/projects-infer", auth ? { headers: { authorization: auth } } : {});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("NODE_ENV", "test");
  mocks.founder.mockResolvedValue({ id: "founder", email: "e@x.com" });
  mocks.sync.mockResolvedValue({ status: "ok", items: 40, projects: 8, ms: 5 });
});

describe("GET /api/cron/projects-infer", () => {
  it("requires the cron secret in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "s3cret");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
    log.mockRestore();
  });

  it("runs for the founder and logs the counts", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await GET(req());
    expect(await res.json()).toEqual({ status: "ok", items: 40, projects: 8, ms: 5 });
    expect(mocks.sync).toHaveBeenCalledWith("founder");
    expect(log).toHaveBeenCalledWith("projects-infer cron", JSON.stringify({ status: "ok", items: 40, projects: 8, ms: 5 }));
    log.mockRestore();
  });

  it("404s without a founder and 502s when the run fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.founder.mockResolvedValueOnce(null);
    expect((await GET(req())).status).toBe(404);
    mocks.sync.mockResolvedValueOnce({ status: "failed", error: "claude: timeout", ms: 150000 });
    expect((await GET(req())).status).toBe(502);
    err.mockRestore();
    log.mockRestore();
  });
});
