import { describe, expect, it } from "vitest";
import { padNoteFileName, padNoteMarkdown, referencedImages } from "./pad";

describe("padNoteFileName", () => {
  it("removes characters that can't be in a file name and collapses whitespace", () => {
    expect(padNoteFileName("Sample topic: a primer")).toBe("Sample topic a primer");
    expect(padNoteFileName(' A/B \\ C? *D* "E" <F> |G| ')).toBe("AB C D E F G");
    expect(padNoteFileName("Line one\nline\ttwo\u0007")).toBe("Line one line two");
  });

  it("strips leading dots so EC Pad doesn't hide the note", () => {
    expect(padNoteFileName("...Hidden")).toBe("Hidden");
    expect(padNoteFileName(". Spaced")).toBe("Spaced");
  });

  it("caps the length and falls back when nothing is left", () => {
    const long = padNoteFileName(`${"word ".repeat(30)}end`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(" ")).toBe(false);
    expect(padNoteFileName("  ")).toBe("Research report");
    expect(padNoteFileName("://??")).toBe("Research report");
    expect(padNoteFileName("..")).toBe("Research report");
  });
});

describe("referencedImages", () => {
  it("lists each safe images/ file once", () => {
    const md = [
      "![Hero](images/hero.jpg)",
      "![Again](images/hero.jpg)",
      "![Chair](images/chair-01.png)",
      "![Nested](images/sub/x.jpg)",
      "![Up](images/../secret.jpg)",
      "![Hidden](images/.x.jpg)",
      "![Remote](https://example.test/images/y.jpg)",
      "![Other](pictures/z.jpg)",
    ].join("\n\n");
    expect(referencedImages(md)).toEqual(["hero.jpg", "chair-01.png"]);
  });

  it("returns nothing for Markdown without pictures", () => {
    expect(referencedImages("# Title\n\nText.")).toEqual([]);
  });
});

describe("padNoteMarkdown", () => {
  const date = new Date(2026, 10, 17, 9, 30);
  const options = { title: "Example Co", reportId: "r1", pdfUrl: "https://blob.example.invalid/r1.pdf", pageCount: 14, date };

  it("adds the PDF link under the title, rewrites picture paths and ends with provenance", () => {
    const md = "# Example Co\r\n\r\nOpening.\r\n\r\n![Hero](images/hero.jpg)\r\n\r\n*The signature piece. A caption.*\r\n\r\n![Up](images/../x.jpg)\r\n";
    expect(padNoteMarkdown(md, options)).toBe(
      "# Example Co\n\n" +
        "[Illustrated PDF](https://blob.example.invalid/r1.pdf) · 14 pages\n\n" +
        "Opening.\n\n" +
        "![Hero](images/r1/hero.jpg)\n\n" +
        "*The signature piece. A caption.*\n\n" +
        "![Up](images/../x.jpg)\n\n" +
        "From Claude Code · 2026-11-17 · research report r1\n",
    );
  });

  it("prepends the title when the Markdown doesn't start with one", () => {
    const note = padNoteMarkdown("\n\nJust text.\n\n## Section\n", options);
    expect(note.startsWith("# Example Co\n\n[Illustrated PDF](https://blob.example.invalid/r1.pdf) · 14 pages\n\nJust text.\n\n## Section\n\n")).toBe(true);
    expect(padNoteMarkdown("## Not a title\n", options).startsWith("# Example Co\n\n")).toBe(true);
  });

  it("drops the page count, or the whole PDF line, when unknown", () => {
    expect(padNoteMarkdown("# T\n\nBody.", { ...options, pageCount: null })).toBe(
      "# T\n\n[Illustrated PDF](https://blob.example.invalid/r1.pdf)\n\nBody.\n\nFrom Claude Code · 2026-11-17 · research report r1\n",
    );
    expect(padNoteMarkdown("# T\n\nBody.", { ...options, pdfUrl: null })).toBe("# T\n\nBody.\n\nFrom Claude Code · 2026-11-17 · research report r1\n");
  });

  it("ends with exactly one newline, even for a title-only note", () => {
    const note = padNoteMarkdown("# T\n\n\n\n", options);
    expect(note).toBe("# T\n\n[Illustrated PDF](https://blob.example.invalid/r1.pdf) · 14 pages\n\nFrom Claude Code · 2026-11-17 · research report r1\n");
    expect(padNoteMarkdown("", { ...options, pdfUrl: null })).toBe("# Example Co\n\nFrom Claude Code · 2026-11-17 · research report r1\n");
  });
});
