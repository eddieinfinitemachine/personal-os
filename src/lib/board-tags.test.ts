import { describe, expect, it, vi } from "vitest";

// board-tags imports the Prisma client; these tests only touch pure helpers.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { buildTagPrompt, MAX_TAG_LENGTH, parseTags, rankTags } from "@/lib/board-tags";

describe("parseTags", () => {
  it("reads the tags array out of a JSON reply", () => {
    expect(parseTags('{"tags": ["Musicians"]}')).toEqual(["Musicians"]);
    expect(parseTags('Sure!\n```json\n{"tags": ["Architecture", "Interiors"]}\n```')).toEqual([
      "Architecture",
      "Interiors",
    ]);
  });

  it("returns [] for anything unparseable", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags("Musicians")).toEqual([]);
    expect(parseTags("{tags: nope}")).toEqual([]);
    expect(parseTags('{"tags": "Musicians"}')).toEqual([]);
    expect(parseTags('{"other": ["Musicians"]}')).toEqual([]);
    expect(parseTags('{"tags": [1, null, {}]}')).toEqual([]);
  });

  it("trims, collapses whitespace, strips stray punctuation and drops empties", () => {
    expect(parseTags('{"tags": ["  Street   Photography ", "#Films.", "   ", ""]}')).toEqual([
      "Street Photography",
      "Films",
    ]);
  });

  it("dedupes case-insensitively and caps at two tags", () => {
    expect(parseTags('{"tags": ["Books", "books", "Films", "Art"]}')).toEqual(["Books", "Films"]);
  });

  it("caps tag length", () => {
    const [tag] = parseTags(JSON.stringify({ tags: ["A".repeat(80)] }));
    expect(tag).toHaveLength(MAX_TAG_LENGTH);
  });

  it("adopts the spelling of an existing tag", () => {
    expect(parseTags('{"tags": ["musicians", "Fashion"]}', ["Musicians", "Restaurants"])).toEqual([
      "Musicians",
      "Fashion",
    ]);
  });
});

describe("rankTags", () => {
  it("orders distinct tags by use, then alphabetically", () => {
    expect(rankTags([["Musicians"], ["Films", "Musicians"], ["Architecture"], ["Films"], ["Musicians"]])).toEqual([
      "Musicians",
      "Films",
      "Architecture",
    ]);
    expect(rankTags([])).toEqual([]);
  });
});

describe("buildTagPrompt", () => {
  it("lists existing tags and the item's fields", () => {
    const p = buildTagPrompt(
      { kind: "note", title: null, note: "Leonard\n\nCohen", url: null, siteName: null, imageUrl: null },
      ["Musicians", "Films"],
    );
    expect(p).toContain("Their existing tags: Musicians, Films");
    expect(p).toContain("Kind: note");
    expect(p).toContain("Note: Leonard Cohen");
    expect(p).not.toContain("URL:");
  });

  it("says when there are no tags yet", () => {
    const p = buildTagPrompt(
      { kind: "link", title: "Casa Malaparte", note: null, url: "https://example.com/x", siteName: "example.com", imageUrl: null },
      [],
    );
    expect(p).toContain("They have no tags yet.");
    expect(p).toContain("Title: Casa Malaparte");
    expect(p).toContain("URL: https://example.com/x");
  });
});
