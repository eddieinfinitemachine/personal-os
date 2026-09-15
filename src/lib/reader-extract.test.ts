import { describe, expect, it } from "vitest";
import { extractArticleFromHtml } from "@/lib/reader-extract";

describe("extractArticleFromHtml", () => {
  it("extracts readable metadata and content from saved HTML", () => {
    const paragraph =
      "The analytical engine was designed to manipulate symbols as well as numbers, making it a conceptual ancestor of modern general-purpose computers.";
    const html = `<!doctype html>
      <html>
        <head>
          <title>Computing Before Computers</title>
          <meta name="author" content="Ada Lovelace" />
          <meta property="og:site_name" content="History Journal" />
          <meta property="og:image" content="https://example.com/cover.jpg" />
        </head>
        <body>
          <article>
            <h1>Computing Before Computers</h1>
            <p>${paragraph}</p>
            <p>${paragraph}</p>
            <p>${paragraph}</p>
            <p>${paragraph}</p>
          </article>
        </body>
      </html>`;

    const article = extractArticleFromHtml(
      "https://example.com/articles/computing",
      html,
    );

    expect(article.title).toBe("Computing Before Computers");
    expect(article.byline).toBe("Ada Lovelace");
    expect(article.siteName).toBe("History Journal");
    expect(article.imageUrl).toBe("https://example.com/cover.jpg");
    expect(article.wordCount).toBeGreaterThan(50);
    expect(article.contentHtml).toContain("analytical engine");
    expect(article.url).toBe("https://example.com/articles/computing");
  });
});
