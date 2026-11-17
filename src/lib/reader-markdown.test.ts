import { describe, expect, it } from "vitest";
import { readerHtmlToMarkdown } from "@/lib/reader-markdown";

const base = "https://example.com/posts/article";
const md = (html: string) => readerHtmlToMarkdown(html, base);

describe("readerHtmlToMarkdown", () => {
  it("returns an empty string when there is no body", () => {
    expect(md("")).toBe("");
    expect(md("   \n  ")).toBe("");
    expect(md("<div>  </div>")).toBe("");
  });

  it("converts headings and paragraphs with ATX hashes and no escapes", () => {
    expect(md("<h2>Why it matters</h2><p>Use snake_case and 2 * 3 [sic].</p><h3>Next</h3>")).toBe(
      "## Why it matters\n\nUse snake_case and 2 * 3 [sic].\n\n### Next",
    );
  });

  it("converts emphasis, strong and strikethrough", () => {
    expect(md("<p><em>soft</em> <strong>loud</strong> <del>gone</del></p>")).toBe("*soft* **loud** ~~gone~~");
  });

  it("converts bullet, ordered and nested lists with CommonMark indents", () => {
    expect(md("<ul><li>One</li><li>Two<ul><li>Inner</li></ul></li></ul>")).toBe("- One\n- Two\n  - Inner");
    expect(md('<ol start="3"><li>Three</li><li>Four<ol><li>Sub</li></ol></li></ol>')).toBe("3. Three\n4. Four\n   1. Sub");
  });

  it("makes links absolute and encodes parentheses", () => {
    expect(md('<p>See <a href="/wiki/Foo_(bar)">the [long] page</a> and <a href="https://x.test/a b">x</a>.</p>')).toBe(
      "See [the (long) page](https://example.com/wiki/Foo_%28bar%29) and [x](https://x.test/a%20b).",
    );
  });

  it("drops script links and links with no text, keeping their words", () => {
    expect(md('<p><a href="javascript:alert(1)">Click</a> <a href="/x"></a>done</p>')).toBe("Click done");
  });

  it("puts every image in its own paragraph with an absolute URL", () => {
    expect(md('<p>Before <img src="../img/a.png" alt="A [chart]"> after</p>')).toBe(
      "Before\n\n![A (chart)](https://example.com/img/a.png)\n\nafter",
    );
  });

  it("unwraps a linked image and drops data: images to their alt text", () => {
    expect(md('<p><a href="/full.jpg"><img src="/thumb.jpg" alt="Thumb"></a></p>')).toBe(
      "![Thumb](https://example.com/thumb.jpg)",
    );
    expect(md('<p><img src="data:image/png;base64,AAAA" alt="Inline"></p>')).toBe("Inline");
  });

  it("converts inline code, fenced code with a language, and bare pre blocks", () => {
    expect(md("<p>Run <code>npm test</code>.</p>")).toBe("Run `npm test`.");
    expect(md('<pre><code class="language-ts">const a = 1;\nconst b = 2;\n</code></pre>')).toBe(
      "```ts\nconst a = 1;\nconst b = 2;\n```",
    );
    expect(md("<pre>line one\n  line ``` two</pre>")).toBe("````\nline one\n  line ``` two\n````");
  });

  it("converts tables with a header row, escaping pipes and padding short rows", () => {
    expect(
      md(
        "<table><thead><tr><th>Name</th><th>Score</th></tr></thead>" +
          "<tbody><tr><td>A|B</td><td><strong>9</strong></td></tr><tr><td>C</td></tr></tbody></table>",
      ),
    ).toBe("| Name | Score |\n| --- | --- |\n| A\\|B | **9** |\n| C |  |");
  });

  it("uses the first row as the header of a table without one", () => {
    expect(md("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d<br>e</td></tr></table>")).toBe(
      "| a | b |\n| --- | --- |\n| c | d e |",
    );
  });

  it("unwraps a one-column layout table", () => {
    expect(md("<table><tr><td><p>Only words</p></td></tr></table>")).toBe("Only words");
  });

  it("strips scripts, styles and navigation", () => {
    expect(
      md("<nav><a href='/'>Home</a></nav><style>p{}</style><p>Body</p><script>alert(1)</script><form><button>Go</button></form>"),
    ).toBe("Body");
  });

  it("is deterministic and collapses runs of blank lines", () => {
    const html = "<p>One</p><div><br><br><br></div><p>Two</p><hr><blockquote><p>Quote</p></blockquote>";
    expect(md(html)).toBe(md(html));
    expect(md(html)).toBe("One\n\nTwo\n\n---\n\n> Quote");
  });
});
