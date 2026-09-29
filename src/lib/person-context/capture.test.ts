import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { IntakeError } from "@/lib/dating-intake/contracts";
import { parseContextCapture } from "./capture";
import { CONTEXT_LIMITS } from "./types";

const now = new Date("2026-09-29T12:00:00Z");
const message = (i: number, extra: object = {}) => ({ id: `m${i}`, sentAt: "2026-09-01T00:00:00Z", fromMe: i % 2 === 0, text: "hello", ...extra });
const body = (messages: unknown[], extra: object = {}) => ({ personId: "p1", threads: [{ source: "imessage", messages }], ...extra });
const rejects = (input: unknown) => {
  try { parseContextCapture(input, now); } catch (e) { return e instanceof IntakeError && e.status === 400; }
  return false;
};

describe("parseContextCapture", () => {
  it("accepts a bounded payload", () => {
    const parsed = parseContextCapture({ ...body([message(1)]), force: true }, now);
    expect(parsed).toEqual({ personId: "p1", force: true, threads: [{ source: "imessage", messages: [{ id: "m1", sentAt: "2026-09-01T00:00:00.000Z", fromMe: false, text: "hello" }] }] });
    expect(parseContextCapture({ personId: "p1", threads: [] }, now).force).toBe(false);
  });

  it("rejects malformed bodies", () => {
    expect(rejects(null)).toBe(true);
    expect(rejects([])).toBe(true);
    expect(rejects({ threads: [] })).toBe(true);
    expect(rejects({ personId: "x".repeat(201), threads: [] })).toBe(true);
    expect(rejects({ personId: "p1" })).toBe(true);
    expect(rejects(body([message(1)], { force: "yes" }))).toBe(true);
    expect(rejects({ personId: "p1", threads: [{ source: "sms", messages: [] }] })).toBe(true);
    expect(rejects({ personId: "p1", threads: [{ source: "imessage", messages: [] }, { source: "imessage", messages: [] }] })).toBe(true);
    expect(rejects(body([message(1, { id: 5 })]))).toBe(true);
    expect(rejects(body([message(1, { text: null })]))).toBe(true);
    expect(rejects(body([message(1, { fromMe: "true" })]))).toBe(true);
    expect(rejects(body([message(1), message(1)]))).toBe(true);
  });

  it("rejects dates outside the thread window", () => {
    expect(rejects(body([message(1, { sentAt: "not a date" })]))).toBe(true);
    expect(rejects(body([message(1, { sentAt: "2025-09-01T00:00:00Z" })]))).toBe(true);
    expect(rejects(body([message(1, { sentAt: "2026-09-30T00:00:00Z" })]))).toBe(true);
    expect(rejects(body([message(1, { sentAt: "2025-10-01T00:00:00Z" })]))).toBe(false);
  });

  it("enforces message and character caps", () => {
    expect(rejects(body([message(1, { text: "x".repeat(CONTEXT_LIMITS.maxCharsPerMessage) })]))).toBe(false);
    expect(rejects(body([message(1, { text: "x".repeat(CONTEXT_LIMITS.maxCharsPerMessage + 1) })]))).toBe(true);
    const many = Array.from({ length: CONTEXT_LIMITS.maxMessagesPerPerson + 1 }, (_, i) => message(i, { text: "a" }));
    expect(rejects(body(many.slice(0, -1)))).toBe(false);
    expect(rejects(body(many))).toBe(true);
    const total = Array.from({ length: CONTEXT_LIMITS.maxThreadChars / CONTEXT_LIMITS.maxCharsPerMessage + 1 }, (_, i) => message(i, { text: "x".repeat(CONTEXT_LIMITS.maxCharsPerMessage) }));
    expect(rejects(body(total))).toBe(true);
  });
});
