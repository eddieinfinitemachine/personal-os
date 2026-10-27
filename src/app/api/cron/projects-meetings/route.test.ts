import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ founder: vi.fn(), sync: vi.fn(), google: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cron", async (orig) => ({ ...(await orig<typeof import("@/lib/cron")>()), getFounderUser: mocks.founder }));
vi.mock("@/lib/google", () => ({ isGoogleConfigured: mocks.google }));
vi.mock("@/lib/projects/meetings", () => ({ syncMeetingProjects: mocks.sync }));
import { GET } from "./route";

const req = (auth?: string) =>
  new Request("https://example.invalid/api/cron/projects-meetings", auth ? { headers: { authorization: auth } } : {});

const RESULT = {
  calendarEvents: 4, granolaNotes: 2, processed: 5, excluded: 1, linked: 2, unlinked: 2, deferred: 0, replaced: 0,
  topicsCreated: ["Synthetic topic"], topicsSuggested: [], errors: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("GRANOLA_API_KEY", "synthetic");
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic");
  mocks.google.mockReturnValue(true);
  mocks.founder.mockResolvedValue({ id: "founder", email: "e@x.com" });
  mocks.sync.mockResolvedValue(RESULT);
});

describe("GET /api/cron/projects-meetings", () => {
  it("requires the cron secret in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(req())).status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
  });

  it("skips cleanly when neither Granola nor Google is configured, or Claude isn't", async () => {
    vi.stubEnv("GRANOLA_API_KEY", "");
    mocks.google.mockReturnValue(false);
    expect((await (await GET(req())).json()).skipped).toMatch(/not set/);
    mocks.google.mockReturnValue(true);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await (await GET(req())).json()).toEqual({ skipped: "ANTHROPIC_API_KEY not set" });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("runs with only one source configured, and logs counts but not topic names", async () => {
    vi.stubEnv("GRANOLA_API_KEY", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await GET(req());
    expect(await res.json()).toEqual(RESULT);
    expect(mocks.sync).toHaveBeenCalledWith("founder");
    expect(log.mock.calls.flat().join(" ")).not.toContain("Synthetic topic");
    log.mockRestore();
  });
});
