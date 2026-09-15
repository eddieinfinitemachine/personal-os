import { describe, expect, it } from "vitest";
import { kindleFilename } from "@/lib/kindle-epub";
import { sniffImageType } from "@/lib/kindle";

describe("sniffImageType", () => {
  it.each([
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "jpeg"],
    [
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "png",
    ],
    [Buffer.from("GIF87a", "ascii"), "gif"],
    [Buffer.from("GIF89a", "ascii"), "gif"],
    [Buffer.from("RIFFxxxxWEBP", "ascii"), "webp"],
    [Buffer.from("xxxxftypavif", "ascii"), "avif"],
    [Buffer.from("xxxxftypavis", "ascii"), "avif"],
    [Buffer.from("  <svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"), "svg"],
    [Buffer.from("<?xml version=\"1.0\"?><svg></svg>"), "svg"],
    [Buffer.from("not an image"), null],
  ])("detects image signature %#", (buffer, expected) => {
    expect(sniffImageType(buffer as Buffer)).toBe(expected);
  });
});

describe("kindleFilename", () => {
  it("keeps a readable title (Amazon shows the filename as the title)", () => {
    expect(
      kindleFilename("A journey to the heart of history\u2019s largest nonterritorial empire"),
    ).toBe("A journey to the heart of history's largest nonterritorial empire.epub");
  });

  it("normalizes accents, drops non-ASCII and emoji", () => {
    expect(kindleFilename("Cr\u00e8me br\u00fbl\u00e9e \u6771\u4eac \ud83d\ude80")).toBe(
      "Creme brulee.epub",
    );
  });

  it("replaces unsafe punctuation, smart quotes and dashes", () => {
    expect(kindleFilename("  A Title: With / Punctuation!  ")).toBe(
      "A Title With Punctuation!.epub",
    );
    expect(kindleFilename("Big Tech \u2014 \u201cWhy\u201d it matters")).toBe(
      "Big Tech - Why it matters.epub",
    );
  });

  it("limits the name to 75 characters without trailing separators", () => {
    const filename = kindleFilename("word ".repeat(100));
    const name = filename.slice(0, -".epub".length);
    expect(name.length).toBeLessThanOrEqual(75);
    expect(filename).toMatch(/^[A-Za-z0-9 '.,!&()+-]+\.epub$/);
    expect(name).not.toMatch(/[\s.,-]$/);
  });

  it.each(["", "   ", "\u6771\u4eac \ud83d\ude80", "..."])(
    "uses the fallback when nothing readable remains (%j)",
    (title) => {
      expect(kindleFilename(title)).toBe("Article.epub");
    },
  );
});
