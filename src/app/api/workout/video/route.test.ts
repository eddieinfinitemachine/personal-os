import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/workout-video", async (orig) => ({
  ...(await orig<typeof import("@/lib/workout-video")>()),
  findExerciseVideo: mocks.find,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { GET } from "./route";

const req = (query: string) => new Request(`https://example.invalid/api/workout/video?${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.find.mockResolvedValue({ youtubeId: "dQw4w9WgXcQ", title: "T", channel: null });
});

describe("GET /api/workout/video", () => {
  it("returns the demo for a named exercise, trimmed and bounded", async () => {
    const res = await GET(req(`name=${encodeURIComponent("  Goblet squat ")}&equipment=kettlebell`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ video: { youtubeId: "dQw4w9WgXcQ", title: "T", channel: null } });
    expect(mocks.find).toHaveBeenCalledWith("Goblet squat", "kettlebell");
    await GET(req(`name=${"x".repeat(200)}`));
    expect(mocks.find.mock.calls[1][0]).toHaveLength(80);
  });
  it("says null when nothing fits, 400 without a name, 401 signed out, 502 on failure", async () => {
    mocks.find.mockResolvedValue(null);
    expect(await (await GET(req("name=Plank"))).json()).toEqual({ video: null });
    expect((await GET(req("name=%20"))).status).toBe(400);
    mocks.user.mockResolvedValue(null);
    expect((await GET(req("name=Plank"))).status).toBe(401);
    expect(mocks.find).toHaveBeenCalledTimes(1);
    mocks.user.mockResolvedValue("u1");
    mocks.find.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await GET(req("name=Plank"))).status).toBe(502);
  });
});
