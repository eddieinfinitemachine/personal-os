import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { buildEpub } from "@/lib/kindle-epub";

const DC_NS = "http://purl.org/dc/elements/1.1/";
const epubcheckProbe = spawnSync("epubcheck", ["--version"], {
  encoding: "utf8",
});
const hasEpubcheck =
  !epubcheckProbe.error ||
  !("code" in epubcheckProbe.error) ||
  epubcheckProbe.error.code !== "ENOENT";

describe("buildEpub", () => {
  let epub: Buffer;

  beforeAll(async () => {
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 220, g: 20, b: 60 },
      },
    })
      .png()
      .toBuffer();
    const jpeg = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: { r: 30, g: 144, b: 255 },
      },
    })
      .jpeg()
      .toBuffer();

    epub = await buildEpub({
      title: "Research & Reading",
      author: "Ada & Grace",
      siteName: "Example <Journal>",
      sourceUrl: "https://example.com/article?a=1&b=2",
      savedAt: new Date("2026-09-15T13:25:42.123Z"),
      contentHtml: `
        <p id="duplicate">Space&nbsp;and&mdash;dash<script>alert("bad")</script></p>
        <font title="old">Font text</font>
        <center style="color:red">Centered text</center>
        <picture>
          <source srcset="bad.webp 2x">
          <img src="images/img-001.png" alt="Red & blue" srcset="bad.png 2x" sizes="100vw" width="900">
        </picture>
        <p id="duplicate">Duplicate id</p>
        <p>Before figure
          <figure style="width: 100px">
            <img src="images/img-002.jpg">
            <figcaption>Caption</figcaption>
          </figure>
          after figure
        </p>
        <p><a href="https://example.com/outer">Outer <a href="https://example.com/inner">inner</a> end</a></p>
        <span></span><figure>orphaned figure text</figure>
        <p>Invalid control: \u0001 done.</p>
      `,
      images: [
        { href: "images/img-001.png", mediaType: "image/png", data: png },
        { href: "images/img-002.jpg", mediaType: "image/jpeg", data: jpeg },
      ],
      coverHref: "images/img-001.png",
    });
  });

  it("writes an uncompressed mimetype as the first ZIP entry", async () => {
    expect(epub.readUInt32LE(0)).toBe(0x04034b50);
    expect(epub.readUInt16LE(8)).toBe(0);
    const filenameLength = epub.readUInt16LE(26);
    expect(epub.subarray(30, 30 + filenameLength).toString("utf8")).toBe(
      "mimetype",
    );

    const zip = await JSZip.loadAsync(epub);
    await expect(zip.file("mimetype")!.async("string")).resolves.toBe(
      "application/epub+zip",
    );
  });

  it("has a correct container and a one-to-one manifest", async () => {
    const zip = await JSZip.loadAsync(epub);
    const containerXml = await zip
      .file("META-INF/container.xml")!
      .async("string");
    const container = new JSDOM(containerXml, {
      contentType: "application/xml",
    }).window.document;
    expect(
      container.querySelector("rootfile")?.getAttribute("full-path"),
    ).toBe("OEBPS/content.opf");

    const opfXml = await zip.file("OEBPS/content.opf")!.async("string");
    const opf = new JSDOM(opfXml, {
      contentType: "application/xml",
    }).window.document;
    const manifestFiles = Array.from(opf.querySelectorAll("manifest item"))
      .map((item) => `OEBPS/${item.getAttribute("href")}`)
      .sort();
    const archiveFiles = Object.entries(zip.files)
      .filter(
        ([name, entry]) =>
          !entry.dir &&
          ![
            "mimetype",
            "META-INF/container.xml",
            "OEBPS/content.opf",
          ].includes(name),
      )
      .map(([name]) => name)
      .sort();
    expect(manifestFiles).toEqual(archiveFiles);
    expect(
      opf
        .querySelector('item[href="images/img-001.png"]')
        ?.getAttribute("properties"),
    ).toBe("cover-image");
  });

  it("emits required EPUB3 metadata", async () => {
    const zip = await JSZip.loadAsync(epub);
    const opfXml = await zip.file("OEBPS/content.opf")!.async("string");
    const opf = new JSDOM(opfXml, {
      contentType: "application/xml",
    }).window.document;
    const modified = opf
      .querySelector('meta[property="dcterms:modified"]')
      ?.textContent;
    expect(modified).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );

    const uniqueIdentifier = opf.documentElement.getAttribute(
      "unique-identifier",
    );
    const identifier = opf.getElementsByTagNameNS(DC_NS, "identifier")[0];
    expect(uniqueIdentifier).toBe(identifier.getAttribute("id"));
    expect(identifier.textContent).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("serializes well-formed sanitized XHTML", async () => {
    const zip = await JSZip.loadAsync(epub);
    const article = await zip.file("OEBPS/article.xhtml")!.async("string");
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    expect(
      () =>
        new JSDOM(article, {
          contentType: "application/xhtml+xml",
        }),
    ).not.toThrow();
    expect(
      () =>
        new JSDOM(nav, {
          contentType: "application/xhtml+xml",
        }),
    ).not.toThrow();

    expect(article).not.toMatch(/srcset|<script|<font|style=/i);
    expect(article).not.toContain("\u0001");
    const document = new JSDOM(article, {
      contentType: "application/xhtml+xml",
    }).window.document;
    expect(document.querySelectorAll("#duplicate")).toHaveLength(1);
    expect(document.querySelector("a a")).toBeNull();
    expect(document.querySelector("p figure")).toBeNull();
    expect(
      document
        .querySelector('img[src="images/img-002.jpg"]')
        ?.getAttribute("alt"),
    ).toBe("");
  });

  it.skipIf(!hasEpubcheck)("passes epubcheck", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kindle-epub-"));
    const epubPath = path.join(directory, "article.epub");
    try {
      await writeFile(epubPath, epub);
      const result = spawnSync("epubcheck", [epubPath], {
        encoding: "utf8",
      });
      expect(`${result.stdout}\n${result.stderr}`).toMatch(
        /No errors or warnings detected|Messages:\s+0 fatals?\s+\/\s+0 errors?/i,
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
