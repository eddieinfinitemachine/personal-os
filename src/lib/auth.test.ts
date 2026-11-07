import { describe, expect, it, vi } from "vitest";
import { SignJWT, decodeJwt } from "jose";
vi.hoisted(() => {
  process.env.JWT_SECRET = "auth-test-secret";
});
import { APP_SESSION_MAX_AGE, signSession, verifySession } from "./auth";

const user = { id: "user-1", email: "eddie@example.com" };
const DAY = 24 * 60 * 60;
const lifetime = (jwt: string) => {
  const { exp, iat } = decodeJwt(jwt);
  return (exp ?? 0) - (iat ?? 0);
};
const sign = (claims: Record<string, unknown>, secret: string, exp: number | string) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));

describe("signSession", () => {
  it("signs a 7-day web session with no client claim", async () => {
    const jwt = await signSession(user);
    expect(lifetime(jwt)).toBe(7 * DAY);
    expect(decodeJwt(jwt)).toMatchObject({ userId: "user-1", email: "eddie@example.com" });
    expect(decodeJwt(jwt)).not.toHaveProperty("client");
  });

  it("signs a 180-day app session that carries client: app", async () => {
    expect(APP_SESSION_MAX_AGE).toBe(180 * DAY);
    const jwt = await signSession(user, { maxAge: APP_SESSION_MAX_AGE, client: "app" });
    expect(lifetime(jwt)).toBe(180 * DAY);
    expect(decodeJwt(jwt)).toMatchObject({ userId: "user-1", email: "eddie@example.com", client: "app" });
  });
});

describe("verifySession", () => {
  it("accepts web and app sessions alike", async () => {
    const session = { userId: "user-1", email: "eddie@example.com" };
    expect(await verifySession(await signSession(user))).toEqual(session);
    expect(
      await verifySession(await signSession(user, { maxAge: APP_SESSION_MAX_AGE, client: "app" })),
    ).toEqual(session);
  });

  it("rejects garbage, a foreign signature, an expired token and missing claims", async () => {
    const claims = { userId: "user-1", email: "eddie@example.com" };
    expect(await verifySession("not-a-jwt")).toBeNull();
    expect(await verifySession(await sign(claims, "some-other-secret", "1h"))).toBeNull();
    expect(await verifySession(await sign(claims, "auth-test-secret", Math.floor(Date.now() / 1000) - 60))).toBeNull();
    expect(await verifySession(await sign({ userId: "user-1" }, "auth-test-secret", "1h"))).toBeNull();
  });
});
