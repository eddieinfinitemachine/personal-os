import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  countUsers: vi.fn(),
  createToken: vi.fn(),
  send: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser, count: mocks.countUsers },
    magicLinkToken: { create: mocks.createToken },
  },
}));
vi.mock("@/lib/email", () => ({ sendMagicLinkEmail: mocks.send }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
import { POST } from "./route";

const requestLink = (body: unknown) =>
  POST(
    new NextRequest("https://example.invalid/api/auth/request-link", {
      method: "POST",
      headers: { "content-type": "application/json", host: "os.example.invalid", "x-forwarded-proto": "https" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MAX_SIGNUPS_PER_DAY", "");
  vi.stubEnv("INVITE_TOKEN", "");
  mocks.findUser.mockResolvedValue({ id: "user-1" });
  mocks.countUsers.mockResolvedValue(0);
  mocks.createToken.mockResolvedValue({});
  mocks.send.mockResolvedValue(undefined);
  mocks.rateLimit.mockReturnValue({ allowed: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/auth/request-link", () => {
  it("emails a web link by default (no client argument)", async () => {
    const res = await requestLink({ email: " Eddie@Example.com " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const token = mocks.createToken.mock.calls[0][0].data.token;
    expect(mocks.send).toHaveBeenCalledWith("eddie@example.com", token, "https://os.example.invalid", undefined);
  });

  it("passes client: app through to the email", async () => {
    const res = await requestLink({ email: "eddie@example.com", client: "app" });
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith("eddie@example.com", expect.any(String), "https://os.example.invalid", "app");
  });

  it("ignores any other client value", async () => {
    await requestLink({ email: "eddie@example.com", client: "web" });
    await requestLink({ email: "eddie@example.com", client: ["app"] });
    expect(mocks.send.mock.calls.map((call) => call[3])).toEqual([undefined, undefined]);
  });

  it("keeps validation and the rate limit ahead of the email", async () => {
    expect((await requestLink({ client: "app" })).status).toBe(400);
    expect((await requestLink({ email: "nope", client: "app" })).status).toBe(400);
    mocks.rateLimit.mockReturnValue({ allowed: false, retryAfterMs: 60_000 });
    expect((await requestLink({ email: "eddie@example.com", client: "app" })).status).toBe(429);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
