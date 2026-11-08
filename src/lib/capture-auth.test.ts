import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
import { signSession } from "@/lib/auth";
import { bearerSession, resolveCaptureUser } from "./capture-auth";

const users: Record<string, { id: string; email: string }> = {
  "founder@example.com": { id: "founder-id", email: "founder@example.com" },
  "mate@example.com": { id: "mate-id", email: "mate@example.com" },
  "app@example.com": { id: "app-id", email: "app@example.com" },
};
const req = ({ bearer, query }: { bearer?: string; query?: string } = {}) =>
  new Request(`https://example.invalid/api/capture/mobile${query ? `?token=${query}` : ""}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
const appSession = (id = "app-id", email = "app@example.com") => signSession({ id, email });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("JWT_SECRET", "capture-auth-test-secret");
  vi.stubEnv("FOUNDER_EMAIL", "founder@example.com");
  vi.stubEnv("CAPTURE_TOKEN", "founder-token");
  vi.stubEnv("CAPTURE_TOKENS", JSON.stringify({ "mate-token": "mate@example.com" }));
  mocks.findUnique.mockImplementation(async ({ where }: { where: { email?: string; id?: string } }) => {
    if (where.email) return users[where.email] ?? null;
    return Object.values(users).find((u) => u.id === where.id) ?? null;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("resolveCaptureUser: static capture tokens", () => {
  it("resolves CAPTURE_TOKEN to the founder, as a bearer or ?token=", async () => {
    expect(await resolveCaptureUser(req({ bearer: "founder-token" }))).toBe("founder-id");
    expect(await resolveCaptureUser(req({ query: "founder-token" }))).toBe("founder-id");
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { email: "founder@example.com" } });
  });

  it("resolves a CAPTURE_TOKENS token to its email's user", async () => {
    expect(await resolveCaptureUser(req({ bearer: "mate-token" }))).toBe("mate-id");
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { email: "mate@example.com" } });
  });

  it("returns null and logs when a token maps to an unknown user", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("CAPTURE_TOKENS", JSON.stringify({ "ghost-token": "ghost@example.com" }));
    expect(await resolveCaptureUser(req({ bearer: "ghost-token" }))).toBeNull();
    expect(quiet).toHaveBeenCalledWith("capture token maps to unknown user ghost@example.com");
    quiet.mockRestore();
  });

  it("stays open as the founder in development with no CAPTURE_TOKEN", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CAPTURE_TOKEN", undefined);
    expect(await resolveCaptureUser(req())).toBe("founder-id");
  });
});

describe("resolveCaptureUser: app session", () => {
  it("resolves a valid session bearer to its user once the row is confirmed", async () => {
    expect(await resolveCaptureUser(req({ bearer: await appSession() }))).toBe("app-id");
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: "app-id" }, select: { id: true } });
  });

  it("accepts the session in production even with no CAPTURE_TOKEN", async () => {
    vi.stubEnv("CAPTURE_TOKEN", undefined);
    expect(await resolveCaptureUser(req({ bearer: await appSession() }))).toBe("app-id");
    expect(await resolveCaptureUser(req())).toBeNull();
  });

  it("returns null and logs when the session's user is gone", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const jwt = await appSession("deleted-id", "deleted@example.com");
    expect(await resolveCaptureUser(req({ bearer: jwt }))).toBeNull();
    expect(quiet).toHaveBeenCalledWith("capture session for unknown user deleted-id");
    quiet.mockRestore();
  });

  it("rejects garbage bearers in production without touching the database", async () => {
    expect(await resolveCaptureUser(req({ bearer: "not-a-token" }))).toBeNull();
    expect(await resolveCaptureUser(req({ bearer: "a.b.c" }))).toBeNull();
    // A real signature over a payload rewritten to claim the founder.
    const [header, , signature] = (await appSession()).split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "founder-id", email: "founder@example.com" })).toString("base64url");
    expect(await resolveCaptureUser(req({ bearer: `${header}.${forged}.${signature}` }))).toBeNull();
    expect(await resolveCaptureUser(req())).toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("ignores a session passed as ?token=", async () => {
    expect(await resolveCaptureUser(req({ query: await appSession() }))).toBeNull();
    vi.stubEnv("CAPTURE_TOKEN", undefined);
    expect(await resolveCaptureUser(req({ query: await appSession() }))).toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});

describe("bearerSession", () => {
  it("returns the session for a valid session bearer, without touching the database", async () => {
    expect(await bearerSession(req({ bearer: await appSession() }))).toEqual({ userId: "app-id", email: "app@example.com" });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("is null for the static capture token, garbage, a forged payload, and no header", async () => {
    expect(await bearerSession(req({ bearer: "founder-token" }))).toBeNull();
    expect(await bearerSession(req({ bearer: "a.b.c" }))).toBeNull();
    const [header, , signature] = (await appSession()).split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "founder-id", email: "founder@example.com" })).toString("base64url");
    expect(await bearerSession(req({ bearer: `${header}.${forged}.${signature}` }))).toBeNull();
    expect(await bearerSession(req({ query: await appSession() }))).toBeNull();
    expect(await bearerSession(req())).toBeNull();
  });
});
