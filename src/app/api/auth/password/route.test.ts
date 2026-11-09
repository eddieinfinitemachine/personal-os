import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decodeJwt } from "jose";
const mocks = vi.hoisted(() => {
  process.env.JWT_SECRET = "password-route-test-secret";
  return {
    upsert: vi.fn(),
    rateLimit: vi.fn(),
    cookieSet: vi.fn(),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: { user: { upsert: mocks.upsert } } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.cookieSet }) }));
import { APP_SESSION_MAX_AGE, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { POST } from "./route";

// Test-only value; never a real password.
const PASSWORD = "test-only-password";
const EMAIL = "eddie@example.com";
const PRIVATE_HOST = "internal.eddiecohen.com";

const signIn = (body: unknown, host: string | null = PRIVATE_HOST) =>
  POST(
    new NextRequest(`https://${host ?? "example.invalid"}/api/auth/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        ...(host ? { host } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("INTERNAL_PASSWORD", PASSWORD);
  vi.stubEnv("FOUNDER_EMAIL", " Eddie@Example.com ");
  mocks.rateLimit.mockReturnValue({ allowed: true });
  mocks.upsert.mockImplementation(async ({ create }: { create: { email: string } }) => ({
    id: "user-1",
    email: create.email,
  }));
});
afterEach(() => vi.unstubAllEnvs());

// Web and app sign-ins share every failure path.
const flows = [
  { flow: "web", extra: {} },
  { flow: "app", extra: { client: "app" } },
] as const;

describe("POST /api/auth/password", () => {
  it("web: sets the 7-day session cookie and returns only { ok: true }", async () => {
    const res = await signIn({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { email: EMAIL },
      update: { lastSeenAt: expect.any(Date) },
      create: { email: EMAIL },
    });
    expect(mocks.rateLimit).toHaveBeenCalledWith("pw:ip:203.0.113.7");
    expect(mocks.cookieSet).toHaveBeenCalledTimes(1);
    const [name, jwt, options] = mocks.cookieSet.mock.calls[0];
    expect(name).toBe(SESSION_COOKIE);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 60 * 60 });
    expect(await verifySession(jwt)).toEqual({ userId: "user-1", email: EMAIL });
    const claims = decodeJwt(jwt);
    expect(claims.client).toBeUndefined();
    expect(claims.exp! - claims.iat!).toBe(7 * 24 * 60 * 60);
  });

  it("app: returns a 180-day app session in the body and sets no cookie", async () => {
    const res = await signIn({ password: PASSWORD, client: "app" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.rateLimit).toHaveBeenCalledWith("pw:ip:203.0.113.7");
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { email: EMAIL },
      update: { lastSeenAt: expect.any(Date) },
      create: { email: EMAIL },
    });

    const body = await res.json();
    expect(body).toEqual({ ok: true, token: expect.any(String), email: EMAIL });
    expect(await verifySession(body.token)).toEqual({ userId: "user-1", email: EMAIL });
    const claims = decodeJwt(body.token);
    expect(claims.client).toBe("app");
    expect(claims.exp! - claims.iat!).toBe(APP_SESSION_MAX_AGE);
  });

  it("treats any client value other than app as web", async () => {
    for (const client of ["web", "APP", ["app"], 1, null]) {
      mocks.cookieSet.mockClear();
      const res = await signIn({ password: PASSWORD, client });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mocks.cookieSet).toHaveBeenCalledTimes(1);
    }
  });

  for (const { flow, extra } of flows) {
    const expectNoSession = async (res: Response) => {
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(mocks.cookieSet).not.toHaveBeenCalled();
      expect((await res.clone().json()).token).toBeUndefined();
    };

    it(`${flow}: a wrong password is a 401 with no session`, async () => {
      const res = await signIn({ password: "wrong", ...extra });
      expect(res.status).toBe(401);
      await expectNoSession(res);
      expect(await res.json()).toEqual({ error: "Incorrect password." });
      expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it(`${flow}: off the private host it is a 404, before the rate limit`, async () => {
      for (const host of ["os.example.invalid", null]) {
        const res = await signIn({ password: PASSWORD, ...extra }, host);
        expect(res.status).toBe(404);
        await expectNoSession(res);
        expect(await res.json()).toEqual({ error: "not found" });
      }
      expect(mocks.rateLimit).not.toHaveBeenCalled();
      expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it(`${flow}: unconfigured is a 503`, async () => {
      for (const [name, value] of [
        ["INTERNAL_PASSWORD", ""],
        ["FOUNDER_EMAIL", ""],
      ]) {
        vi.stubEnv("INTERNAL_PASSWORD", PASSWORD);
        vi.stubEnv("FOUNDER_EMAIL", EMAIL);
        vi.stubEnv(name, value);
        const res = await signIn({ password: PASSWORD, ...extra });
        expect(res.status).toBe(503);
        await expectNoSession(res);
        expect(await res.json()).toEqual({ error: "Password sign-in isn't configured." });
      }
      expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it(`${flow}: rate limited is a 429 with the retry message`, async () => {
      mocks.rateLimit.mockReturnValue({ allowed: false, retryAfterMs: 4 * 60_000 + 1 });
      const res = await signIn({ password: PASSWORD, ...extra });
      expect(res.status).toBe(429);
      await expectNoSession(res);
      expect(await res.json()).toEqual({ error: "Too many attempts. Try again in 5 minutes." });
      expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it(`${flow}: a missing password is a 400`, async () => {
      const res = await signIn({ ...extra });
      expect(res.status).toBe(400);
      await expectNoSession(res);
      expect(await res.json()).toEqual({ error: "password required" });
    });
  }

  it("malformed JSON is a 400 bad request", async () => {
    const res = await signIn("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad request" });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
