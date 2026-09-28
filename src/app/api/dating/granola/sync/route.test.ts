import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), founder: vi.fn(), state: vi.fn(), legacy: vi.fn(), intake: vi.fn(), process: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/cron", () => ({ isFounderUser: mocks.founder }));
vi.mock("@/lib/prisma", () => ({ prisma: { datingSourceState: { findFirst: mocks.state } } }));
vi.mock("@/lib/dating-granola", () => ({ syncGranola: mocks.legacy }));
vi.mock("@/lib/dating-intake/granola", () => ({ syncGranolaIntake: mocks.intake }));
vi.mock("@/lib/dating-intake/extract", () => ({ processSource: mocks.process }));
import { POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("GRANOLA_API_KEY", "synthetic-key"); mocks.user.mockResolvedValue("owner"); mocks.founder.mockResolvedValue(true); mocks.intake.mockResolvedValue({ attempted: 6 }); mocks.process.mockResolvedValue({ backlog: 24 }); });
describe("manual Granola intake routing", () => {
  it("queues an explicit historical range in durable intake and preserves the response used by existing controls", async () => {
    mocks.state.mockResolvedValue({ id: "source", enabled: true });
    const response = await POST(new Request("https://example.invalid", { method: "POST", body: JSON.stringify({ since: "2025-01-01" }) }));
    expect(await response.json()).toMatchObject({ durable: true, processed: 6, remaining: 24, errors: [] });
    expect(mocks.intake).toHaveBeenCalledWith("owner", "source", { since: new Date("2025-01-01T00:00:00Z") });
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it("rejects manual import while paused instead of falling back to legacy ingestion", async () => {
    mocks.state.mockResolvedValue({ id: "source", enabled: false, status: "paused" });
    const response = await POST(new Request("https://example.invalid", { method: "POST", body: "{}" }));
    expect(response.status).toBe(409); expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.intake).not.toHaveBeenCalled();
  });
});
