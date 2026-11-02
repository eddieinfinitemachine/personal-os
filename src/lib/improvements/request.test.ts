import { describe, expect, it } from "vitest";
import { MAX_REQUEST_CHARS, parseContext, parseImprovementInput, toImprovementView } from "./request";

describe("parseImprovementInput", () => {
  it("requires a non-empty request and trims it", () => {
    expect(parseImprovementInput(null)).toEqual({ error: "request required" });
    expect(parseImprovementInput({ request: "   " })).toEqual({ error: "request required" });
    expect(parseImprovementInput({ request: 42 })).toEqual({ error: "request required" });
    expect(parseImprovementInput({ request: "  Focus the search box  " })).toEqual({ request: "Focus the search box", context: null });
  });

  it("rejects requests over the limit", () => {
    expect(parseImprovementInput({ request: "x".repeat(MAX_REQUEST_CHARS + 1) })).toEqual({ error: "request too long (max 4000 characters)" });
    expect(parseImprovementInput({ request: "x".repeat(MAX_REQUEST_CHARS) })).toMatchObject({ request: "x".repeat(MAX_REQUEST_CHARS) });
  });
});

describe("parseContext", () => {
  it("keeps the known fields, trimmed and capped", () => {
    expect(
      parseContext({
        path: "/research",
        title: "  Research   · Personal OS ",
        viewport: { width: 1440, height: 900 },
        version: "v0.371",
        userAgent: "Mozilla/5.0",
        cookie: "secret",
      }),
    ).toEqual({ path: "/research", title: "Research · Personal OS", viewport: { width: 1440, height: 900 }, version: "v0.371", userAgent: "Mozilla/5.0" });
    expect(parseContext({ title: "t".repeat(500) })?.title).toHaveLength(200);
  });

  it("drops values that are the wrong shape", () => {
    expect(parseContext({ path: "https://evil.test/x", viewport: { width: -1, height: 1.5 }, title: 3 })).toBeNull();
    expect(parseContext({ path: "/", viewport: { width: 390, height: "844" } })).toEqual({
      path: "/", title: null, viewport: null, version: null, userAgent: null,
    });
    expect(parseContext("nope")).toBeNull();
    expect(parseContext([1, 2])).toBeNull();
  });
});

describe("toImprovementView", () => {
  it("serialises dates and re-validates stored context", () => {
    const view = toImprovementView({
      id: "i1", request: "Bigger buttons", context: { path: "/", junk: true }, status: "needs_review",
      summary: "Made buttons 44 px.", reviewReason: "touches package.json", prUrl: "https://github.com/x/y/pull/1",
      previewUrl: null, error: null, createdAt: new Date("2026-11-02T12:00:00Z"), completedAt: null,
    });
    expect(view).toMatchObject({
      status: "needs_review",
      context: { path: "/", title: null, viewport: null, version: null, userAgent: null },
      createdAt: "2026-11-02T12:00:00.000Z",
      completedAt: null,
    });
  });
});
