import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
import { GET } from "./route";

const url = "https://example.invalid/api/settings/reading";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue("u1");
  mocks.findUnique.mockResolvedValue({ kindleEmail: "me@kindle.com", kindleAutoSend: true });
});

describe("GET /api/settings/reading", () => {
  it("401s without a session", async () => {
    mocks.user.mockResolvedValueOnce(null);
    const res = await GET(new Request(url));
    expect(res.status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("returns the caller's Kindle settings", async () => {
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ kindleEmail: "me@kindle.com", kindleAutoSend: true });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { kindleEmail: true, kindleAutoSend: true },
    });
  });

  it("returns nulls for an unset address", async () => {
    mocks.findUnique.mockResolvedValueOnce({ kindleEmail: null, kindleAutoSend: false });
    expect(await (await GET(new Request(url))).json()).toEqual({ kindleEmail: null, kindleAutoSend: false });
  });
});
