import { describe, expect, it } from "vitest";
import { isAggregator, parsePublicContext } from "./web";

const results = { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://example.com/about", title: "About" }] };

describe("parsePublicContext", () => {
  it("keeps only sources the search returned", () => {
    const out = parsePublicContext([
      { type: "text", text: "Searching…" },
      results,
      { type: "text", text: '{"confident": true, "matched": "company", "text": "Works at Example Co.", "sources": [{"title": "About", "url": "https://example.com/about"}, {"title": "Made up", "url": "https://invented.example/"}]}' },
    ]);
    expect(out).toEqual({ text: "Works at Example Co.", sources: [{ title: "About", url: "https://example.com/about" }] });
  });

  it("returns undefined when not confident or uncited", () => {
    expect(parsePublicContext([results, { type: "text", text: '{"confident": false}' }])).toBeUndefined();
    expect(parsePublicContext([results, { type: "text", text: '{"confident": true, "matched": "company", "text": "x", "sources": []}' }])).toBeUndefined();
    expect(parsePublicContext([{ type: "text", text: "no json" }])).toBeUndefined();
  });

  it("drops a namesake: a page that matches the name alone is not this person", () => {
    const answer = (extra: string) => ({ type: "text", text: `{"confident": true, ${extra}"text": "Engineer at Other Co.", "sources": [{"title": "About", "url": "https://example.com/about"}]}` });
    expect(parsePublicContext([results, answer("")])).toBeUndefined();
    expect(parsePublicContext([results, answer('"matched": "name", ')])).toBeUndefined();
    expect(parsePublicContext([results, answer('"matched": "role", ')])).toBeDefined();
  });

  it("never cites people-search or contact-data sites, and shows nothing when they are all there is", () => {
    const broker = { type: "web_search_tool_result", content: [{ url: "https://www.zoominfo.com/p/Some-One/123" }, { url: "https://example.com/about" }] };
    const text = (sources: string) => ({ type: "text", text: `{"confident": true, "matched": "company", "text": "Works at Example Co.", "sources": [${sources}]}` });
    const zoom = '{"title": "Contact Some One, Email & Phone Number", "url": "https://www.zoominfo.com/p/Some-One/123"}';
    expect(parsePublicContext([broker, text(zoom)])).toBeUndefined();
    expect(parsePublicContext([broker, text(zoom + ', {"title": "About", "url": "https://example.com/about"}')])?.sources).toEqual([{ title: "About", url: "https://example.com/about" }]);
    expect(isAggregator("https://rocketreach.co/x")).toBe(true);
    expect(isAggregator("https://www.linkedin.com/in/x")).toBe(false);
    expect(isAggregator("not a url")).toBe(true);
  });
});
