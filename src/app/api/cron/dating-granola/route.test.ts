import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), founder: vi.fn(), state: vi.fn(), legacy: vi.fn(), intake: vi.fn(), process: vi.fn() }));
vi.mock("@/lib/cron", () => ({ isAuthorizedCron: mocks.auth, getFounderUser: mocks.founder }));
vi.mock("@/lib/prisma", () => ({ prisma: { datingSourceState: { findFirst: mocks.state } } }));
vi.mock("@/lib/dating-granola", () => ({ syncGranola: mocks.legacy }));
vi.mock("@/lib/dating-intake/granola", () => ({ syncGranolaIntake: mocks.intake }));
vi.mock("@/lib/dating-intake/extract", () => ({ processSource: mocks.process }));
import { GET } from "./route";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("GRANOLA_API_KEY", "synthetic-key"); mocks.auth.mockReturnValue(true); mocks.founder.mockResolvedValue({ id: "owner" }); mocks.intake.mockResolvedValue({ complete: true }); mocks.process.mockResolvedValue({ calls: 0 }); });
describe("Granola cron rollout routing", () => {
  it("uses durable intake for enabled sources", async () => {
    mocks.state.mockResolvedValue({ id: "source", enabled: true });
    expect((await GET(new Request("https://example.invalid"))).status).toBe(200);
    expect(mocks.intake).toHaveBeenCalledWith("owner", "source"); expect(mocks.process).toHaveBeenCalledWith("owner", "source"); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it("does not bypass a user's pause through the legacy importer", async () => {
    mocks.state.mockResolvedValue({ id: "source", enabled: false, status: "paused" });
    expect(await (await GET(new Request("https://example.invalid"))).json()).toMatchObject({ skipped: "Granola intake is paused" });
    expect(mocks.intake).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
});
