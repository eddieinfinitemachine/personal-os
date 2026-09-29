import { describe, expect, it } from "vitest";
import { parsePublicContext } from "./web";

const results = { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://example.com/about", title: "About" }] };

describe("parsePublicContext", () => {
  it("keeps only sources the search returned", () => {
    const out = parsePublicContext([
      { type: "text", text: "Searching…" },
      results,
      { type: "text", text: '{"confident": true, "text": "Works at Example Co.", "sources": [{"title": "About", "url": "https://example.com/about"}, {"title": "Made up", "url": "https://invented.example/"}]}' },
    ]);
    expect(out).toEqual({ text: "Works at Example Co.", sources: [{ title: "About", url: "https://example.com/about" }] });
  });

  it("returns undefined when not confident or uncited", () => {
    expect(parsePublicContext([results, { type: "text", text: '{"confident": false}' }])).toBeUndefined();
    expect(parsePublicContext([results, { type: "text", text: '{"confident": true, "text": "x", "sources": []}' }])).toBeUndefined();
    expect(parsePublicContext([{ type: "text", text: "no json" }])).toBeUndefined();
  });
});
