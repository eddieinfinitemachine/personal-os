import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), findUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.session }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser } } }));
import { GET, dynamic } from "./route";

const check = () => GET(new NextRequest("https://example.invalid/api/auth/session"));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.findUser.mockResolvedValue({ email: "eddie@example.com" });
});

describe("GET /api/auth/session", () => {
  it("is never cached", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("401s without a session", async () => {
    const res = await check();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it("returns the signed-in user's id and email", async () => {
    mocks.session.mockResolvedValue("user-1");
    const res = await check();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1", email: "eddie@example.com" });
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { id: "user-1" }, select: { email: true } });
  });

  it("401s when the session's user no longer exists", async () => {
    mocks.session.mockResolvedValue("deleted-user");
    mocks.findUser.mockResolvedValue(null);
    expect((await check()).status).toBe(401);
  });
});
