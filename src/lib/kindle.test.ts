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
  it("normalizes Unicode and removes emoji", () => {
    expect(kindleFilename("Crème brûlée 東京 🚀")).toBe(
      "creme-brulee.epub",
    );
  });

  it("uses an ASCII lowercase slug", () => {
    expect(kindleFilename("  A Title: With / Punctuation!  ")).toBe(
      "a-title-with-punctuation.epub",
    );
  });

  it("limits the ASCII slug to 80 characters", () => {
    const filename = kindleFilename("word ".repeat(100));
    expect(filename.slice(0, -".epub".length).length).toBeLessThanOrEqual(80);
    expect(filename).toMatch(/^[a-z0-9-]+\.epub$/);
  });

  it.each(["", "   ", "東京 🚀"])(
    "uses the fallback for an empty ASCII slug",
    (title) => {
      expect(kindleFilename(title)).toBe("article.epub");
    },
  );
});
