import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookie: vi.fn(), bearer: vi.fn(), find: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.cookie }));
vi.mock("@/lib/capture-auth", () => ({ bearerSession: mocks.bearer }));
vi.mock("@/lib/prisma", () => ({ prisma: { datingPhoto: { findFirst: mocks.find } } }));
vi.mock("@/lib/user-image", () => ({ readUserImage: mocks.read }));
import { GET } from "@/app/api/dating/photos/[photoId]/content/route";

const get = () => GET(new Request("http://localhost/api/dating/photos/ph/content"), { params: Promise.resolve({ photoId: "ph" }) });

describe("GET /api/dating/photos/[photoId]/content", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cookie.mockResolvedValue(null);
    mocks.bearer.mockResolvedValue(null);
    mocks.find.mockResolvedValue({ id: "ph", personId: "p", url: "blob" });
    mocks.read.mockResolvedValue(Buffer.from([1, 2, 3]));
  });
  it("refuses a request with neither a cookie nor a bearer session", async () => {
    expect((await get()).status).toBe(401);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("serves the web's cookie session", async () => {
    mocks.cookie.mockResolvedValue({ userId: "owner", email: "o@example.com" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(mocks.bearer).not.toHaveBeenCalled();
    expect(mocks.find).toHaveBeenCalledWith({ where: { id: "ph", userId: "owner" } });
  });
  it("serves the native app's bearer session, scoped to that account", async () => {
    mocks.bearer.mockResolvedValue({ userId: "app-owner", email: "a@example.com" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.find).toHaveBeenCalledWith({ where: { id: "ph", userId: "app-owner" } });
    expect(mocks.read).toHaveBeenCalledWith("app-owner", "dating/p", "blob");
  });
  it("is a 404 for another account's photo", async () => {
    mocks.bearer.mockResolvedValue({ userId: "someone", email: "s@example.com" });
    mocks.find.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
