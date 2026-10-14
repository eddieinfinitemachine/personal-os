import { describe, expect, it } from "vitest";
import {
  envelope,
  hash,
  normalizeName,
  normalizeQuote,
  segments,
  safeURL,
} from "./contracts";
describe("review comparisons", () => {
  it("matches names regardless of case, accents and spacing", () => {
    expect(normalizeName("  Zoë   Ríos ")).toBe("zoe rios");
    expect(normalizeName("ZOE\tRIOS")).toBe(normalizeName("Zoë Ríos"));
    expect(normalizeName("Zoe Rios")).not.toBe(normalizeName("Zoe Ross"));
  });
  it("matches re-sent excerpts that differ only in spacing or case", () => {
    const quote = "2026-09-27T00:00:00Z Me: Want to get dinner Friday?";
    expect(normalizeQuote(` ${quote.replace(" Me", "\n Me")} `)).toBe(
      normalizeQuote(quote.toUpperCase()),
    );
    expect(normalizeQuote(quote)).not.toBe(
      normalizeQuote("2026-09-27T00:00:00Z Me: Want to get dinner Saturday?"),
    );
  });
});
describe("intake envelope", () => {
  it("round trips Unicode without changing source bytes", () => {
    const text = "a".repeat(11999) + "🦊\r\n" + "é".repeat(12000);
    const parts = segments(text);
    expect(parts.join("")).toBe(text);
    expect(parts.every((p) => p.length <= 12000)).toBe(true);
    expect(parts[0].endsWith("\ud83e")).toBe(false);
  });
  it("rejects invalid dates, versions, overlong chunks and URLs", () => {
    const base = {
      version: 1,
      externalId: "note-1",
      revision: hash("hello"),
      documentVersion: 1,
      segmentIndex: 0,
      segmentCount: 1,
      text: "hello",
      title: "Journal",
      occurredAt: null,
      url: null,
      identities: [],
      evidenceFamily: null,
    };
    expect(envelope(base).occurredAt).toBeNull();
    for (const change of [
      { documentVersion: 0 },
      { segmentCount: 0 },
      { segmentIndex: 1 },
      { text: "a".repeat(12001) },
      { occurredAt: "oops" },
      { url: "javascript:alert(1)" },
      { identities: ["not a handle"] },
    ])
      expect(() => envelope({ ...base, ...change })).toThrow();
    expect(safeURL("https://example.org/a")).toBe("https://example.org/a");
  });
});
