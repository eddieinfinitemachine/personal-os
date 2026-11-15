import { describe, expect, it } from "vitest";
import { BOARD_READ_MAX, parseBoardRead, tagCounts, toBoardReference } from "./board-read";

describe("board read", () => {
  it("reads the filters and bounds the limit", () => {
    expect(parseBoardRead(new URLSearchParams("tag=Furniture&kind=product&q=lamp&limit=9999"))).toEqual({ tag: "Furniture", kind: "product", q: "lamp", limit: BOARD_READ_MAX });
    expect(parseBoardRead(new URLSearchParams("kind=secrets&limit=-4"))).toEqual({ tag: undefined, kind: undefined, q: undefined, limit: 120 });
  });

  it("returns only the fields a reference picker needs, and only for pictures", () => {
    const row = { id: "a", kind: "product", title: "Lamp", note: null, siteName: "shop", imageUrl: "https://blob/x.jpg", imageWidth: 800, imageHeight: 600, tags: ["Lighting"], savedAt: new Date("2026-11-01T00:00:00Z"), url: "https://shop/lamp", price: "$129", via: "extension", userId: "u" };
    const out = toBoardReference(row);
    expect(out).toEqual({ id: "a", kind: "product", title: "Lamp", note: null, siteName: "shop", imageUrl: "https://blob/x.jpg", imageWidth: 800, imageHeight: 600, tags: ["Lighting"], savedAt: "2026-11-01T00:00:00.000Z" });
    expect(toBoardReference({ ...row, imageUrl: null })).toBeNull();
  });

  it("counts tags across the board, most used first", () => {
    expect(tagCounts([{ tags: ["Chairs", "Wood"] }, { tags: ["Wood"] }, { tags: null }])).toEqual([{ tag: "Wood", count: 2 }, { tag: "Chairs", count: 1 }]);
  });
});
