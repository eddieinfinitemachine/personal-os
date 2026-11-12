import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/personal-record", () => ({ getPersonalRecord: mocks.record }));
import { GET } from "@/app/api/personal/route";

const request = (host = "internal.eddiecohen.com") =>
  new Request("http://localhost/api/personal", { headers: { host } });

describe("GET /api/personal", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue("owner"); });
  it("requires a session", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("is not served off the private host", async () => {
    const res = await GET(request("ec.example.com"));
    expect(res.status).toBe(404);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("answers its own 404 for an account without a record", async () => {
    mocks.record.mockResolvedValue(null);
    const res = await GET(request());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no personal record" });
  });
  it("returns only the signed-in account's record, uncached", async () => {
    mocks.record.mockResolvedValue({ fullName: "A B" });
    const res = await GET(request());
    expect(mocks.record).toHaveBeenCalledWith(expect.anything(), "owner");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ record: { fullName: "A B" } });
  });
});
