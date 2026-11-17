import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.hoisted(() => {
  process.env.JWT_SECRET = "middleware-test-secret";
});
import { APP_SESSION_MAX_AGE, SESSION_COOKIE, signSession } from "@/lib/auth";
import { middleware } from "./middleware";

const user = { id: "user-1", email: "eddie@example.com" };
const run = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  middleware(new NextRequest(`https://example.invalid${path}`, { method, headers }));
// Next encodes the forwarded request headers as x-middleware-request-<name>.
const forwardedUserId = (res: Response) => res.headers.get("x-middleware-request-x-user-id");
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";
const appSession = () => signSession(user, { maxAge: APP_SESSION_MAX_AGE, client: "app" });

describe("middleware sessions", () => {
  it("forwards x-user-id for a cookie session", async () => {
    const res = await run("/api/todos", { cookie: `${SESSION_COOKIE}=${await signSession(user)}` });
    expect(passedThrough(res)).toBe(true);
    expect(forwardedUserId(res)).toBe("user-1");
  });

  it("forwards x-user-id for a bearer session on an API route", async () => {
    const res = await run("/api/todos", { authorization: `Bearer ${await appSession()}` });
    expect(passedThrough(res)).toBe(true);
    expect(forwardedUserId(res)).toBe("user-1");
  });

  it("lets a bearer session through on a page too", async () => {
    const res = await run("/projects", { authorization: `Bearer ${await appSession()}` });
    expect(passedThrough(res)).toBe(true);
    expect(forwardedUserId(res)).toBe("user-1");
  });

  it("falls back to the bearer when the cookie is invalid", async () => {
    const res = await run("/api/todos", {
      cookie: `${SESSION_COOKIE}=stale`,
      authorization: `Bearer ${await appSession()}`,
    });
    expect(forwardedUserId(res)).toBe("user-1");
  });

  it("answers an API call with a bad bearer with a JSON 401, not a login redirect", async () => {
    for (const authorization of ["Bearer not-a-jwt", "Basic dXNlcjpwYXNz"]) {
      const res = await run("/api/todos", { authorization });
      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("still redirects to /login with no Authorization header (web behaviour unchanged)", async () => {
    const res = await run("/api/todos");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(new URL(res.headers.get("location")!).searchParams.get("from")).toBe("/api/todos");
  });

  it("still redirects a page with a bad bearer to /login", async () => {
    const res = await run("/projects", { authorization: "Bearer not-a-jwt" });
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("passes a capture route's non-JWT bearer straight through, with no x-user-id", async () => {
    const res = await run("/api/capture/todo", { authorization: "Bearer static-capture-token" }, "POST");
    expect(passedThrough(res)).toBe(true);
    expect(forwardedUserId(res)).toBeNull();
  });

  it("passes POST /api/calendar/events through for the route's capture-token check; GET /api/calendar keeps the session gate", async () => {
    const post = await run("/api/calendar/events", { authorization: "Bearer static-capture-token", "x-user-id": "spoofed" }, "POST");
    expect(passedThrough(post)).toBe(true);
    expect(forwardedUserId(post)).toBeNull();

    for (const [path, method] of [["/api/calendar/events", "GET"], ["/api/calendar", "POST"], ["/api/calendar", "GET"]]) {
      const res = await run(path, { authorization: "Bearer static-capture-token" }, method);
      expect(res.status).toBe(401);
    }
  });

  it("drops a client-supplied x-user-id when there is no session", async () => {
    for (const path of ["/api/auth/session", "/api/capture/todo"]) {
      const res = await run(path, { "x-user-id": "spoofed", authorization: "Bearer not-a-jwt" });
      expect(passedThrough(res)).toBe(true);
      expect(forwardedUserId(res)).toBeNull();
      expect(res.headers.get("x-middleware-override-headers")).not.toContain("x-user-id");
    }
  });

  it("lets an unauthenticated POST to the password sign-in route through, with or without a bad bearer", async () => {
    for (const headers of [
      { "content-type": "application/json" } as Record<string, string>,
      { "content-type": "application/json", authorization: "Bearer not-a-jwt" },
    ]) {
      const res = await run("/api/auth/password", headers, "POST");
      expect(passedThrough(res)).toBe(true);
      expect(res.headers.get("location")).toBeNull();
      expect(forwardedUserId(res)).toBeNull();
    }
  });

  it("replaces a client-supplied x-user-id with the session's", async () => {
    const res = await run("/api/todos", {
      "x-user-id": "spoofed",
      authorization: `Bearer ${await appSession()}`,
    });
    expect(forwardedUserId(res)).toBe("user-1");
  });
});

describe("middleware: Read Later capture-token reads (EC Pad)", () => {
  const capture = { authorization: "Bearer static-capture-token" };
  const rejected = async (res: Response) => res.status === 401 && (await res.json()).error === "unauthorized";
  const toLogin = (res: Response) => res.status === 307 && new URL(res.headers.get("location")!).pathname === "/login";

  it("lets a non-JWT bearer reach the route for the list, one item and its PATCH, with no x-user-id", async () => {
    for (const [path, method] of [
      ["/api/reader", "GET"],
      ["/api/reader?limit=50&cursor=abc", "GET"],
      ["/api/reader?archived=1", "GET"],
      ["/api/reader/item-1", "GET"],
      ["/api/reader/item-1", "PATCH"],
    ]) {
      const res = await run(path, { ...capture, "x-user-id": "spoofed" }, method);
      expect(passedThrough(res), `${method} ${path}`).toBe(true);
      expect(forwardedUserId(res)).toBeNull();
    }
  });

  it("still forwards the session's user when the bearer is an app session", async () => {
    const res = await run("/api/reader/item-1", { authorization: `Bearer ${await appSession()}` });
    expect(passedThrough(res)).toBe(true);
    expect(forwardedUserId(res)).toBe("user-1");
  });

  it("rejects a capture bearer everywhere else under /api/reader and beyond", async () => {
    for (const [path, method] of [
      ["/api/reader/item-1", "DELETE"],
      ["/api/reader/item-1/highlights", "GET"],
      ["/api/reader/item-1/highlights", "POST"],
      ["/api/reader/item-1/highlights", "DELETE"],
      ["/api/reader/item-1/kindle", "POST"],
      ["/api/reader", "DELETE"],
      ["/api/reader", "PATCH"],
      ["/api/reading", "GET"],
      ["/api/todos", "GET"],
    ]) {
      const res = await run(path, capture, method);
      expect(await rejected(res), `${method} ${path}`).toBe(true);
    }
  });

  it("keeps cookie-less, bearer-less reads behind the login redirect", async () => {
    expect(toLogin(await run("/api/reader"))).toBe(true);
    expect(toLogin(await run("/api/reader/item-1"))).toBe(true);
    expect(toLogin(await run("/api/reader/item-1", {}, "PATCH"))).toBe(true);
  });

  it("still lets the Shortcut's save through without any credential", async () => {
    expect(passedThrough(await run("/api/reader?url=https%3A%2F%2Fx.test"))).toBe(true);
    expect(passedThrough(await run("/api/reader", {}, "POST"))).toBe(true);
  });
});
