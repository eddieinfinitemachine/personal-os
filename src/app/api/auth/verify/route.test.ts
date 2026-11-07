import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  findToken: vi.fn(),
  consume: vi.fn(),
  upsert: vi.fn(),
  sign: vi.fn(),
  setCookie: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    magicLinkToken: { findUnique: mocks.findToken, updateMany: mocks.consume },
    user: { upsert: mocks.upsert },
  },
}));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  signSession: mocks.sign,
  setSessionCookie: mocks.setCookie,
}));
import { GET } from "./route";

const EMAIL = "eddie+app@example.com";
const verify = (query: string) =>
  GET(new NextRequest(`https://example.invalid/api/auth/verify${query}`));
const future = () => new Date(Date.now() + 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findToken.mockResolvedValue({ id: "link-1", email: EMAIL, expiresAt: future() });
  mocks.consume.mockResolvedValue({ count: 1 });
  mocks.upsert.mockResolvedValue({ id: "user-1", email: EMAIL });
  mocks.sign.mockResolvedValue("jwt");
});

describe("GET /api/auth/verify", () => {
  it("web: sets the 7-day session cookie and sends the user home", async () => {
    const res = await verify("?token=abc");
    expect(res.headers.get("location")).toBe("https://example.invalid/");
    expect(mocks.sign).toHaveBeenCalledWith({ id: "user-1", email: EMAIL });
    expect(mocks.setCookie).toHaveBeenCalledWith("jwt");
    expect(mocks.consume).toHaveBeenCalledWith({
      where: { id: "link-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("ignores a client value other than app", async () => {
    const res = await verify("?token=abc&client=web");
    expect(res.headers.get("location")).toBe("https://example.invalid/");
    expect(mocks.sign).toHaveBeenCalledWith({ id: "user-1", email: EMAIL });
    expect(mocks.setCookie).toHaveBeenCalledWith("jwt");
  });

  it("app: signs a 180-day app session and hands it to the app in the fragment, with no cookie", async () => {
    const res = await verify("?token=abc&client=app");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "personalos://signin#token=jwt&email=eddie%2Bapp%40example.com",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.sign).toHaveBeenCalledWith(
      { id: "user-1", email: EMAIL },
      { maxAge: 180 * 24 * 60 * 60, client: "app" },
    );
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { email: EMAIL },
      update: { lastSeenAt: expect.any(Date) },
      create: { email: EMAIL },
    });
  });

  for (const client of ["", "&client=app"]) {
    const flow = client ? "app" : "web";
    const expectLogin = (res: Response, reason: string) => {
      const location = new URL(res.headers.get("location")!);
      expect(location.origin + location.pathname).toBe("https://example.invalid/login");
      expect(location.search).toBe(`?error=${reason}`);
      expect(mocks.sign).not.toHaveBeenCalled();
      expect(mocks.setCookie).not.toHaveBeenCalled();
    };

    it(`${flow}: a missing or unknown token goes back to /login`, async () => {
      expectLogin(await verify(`?x=1${client}`), "missing-token");
      mocks.findToken.mockResolvedValueOnce(null);
      expectLogin(await verify(`?token=nope${client}`), "invalid");
    });

    it(`${flow}: an expired token goes back to /login`, async () => {
      mocks.findToken.mockResolvedValueOnce({ id: "link-1", email: EMAIL, expiresAt: new Date(Date.now() - 1000) });
      expectLogin(await verify(`?token=abc${client}`), "expired");
      expect(mocks.consume).not.toHaveBeenCalled();
    });

    it(`${flow}: a used token goes back to /login`, async () => {
      mocks.consume.mockResolvedValueOnce({ count: 0 });
      expectLogin(await verify(`?token=abc${client}`), "used");
      expect(mocks.upsert).not.toHaveBeenCalled();
    });
  }
});
