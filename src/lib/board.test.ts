import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { embedUrl, kindFromUrl, youtubeId } from "@/lib/board-embed";
import { parseBoardInput, shareCaption, splitUrlAndText } from "@/lib/board-input";
import { parsePageMeta } from "@/lib/board";
import { sniffImage } from "@/lib/board-sniff";

describe("kindFromUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "video"],
    ["https://www.youtube.com/shorts/abcdefghijk", "video"],
    ["https://www.tiktok.com/@a/video/123", "video"],
    ["https://www.instagram.com/reel/Cxyz/", "video"],
    ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "music"],
    ["https://music.apple.com/us/album/x/123?i=456", "music"],
    ["https://music.youtube.com/watch?v=abc", "music"],
    ["https://www.amazon.com/dp/B0C1234", "product"],
    ["https://www.amazon.co.uk/dp/B0C1234", "product"],
    ["https://www.pinterest.com/pin/12345/", "image"],
    ["https://www.instagram.com/p/Cabc/", "image"],
    ["https://example.com/photo.JPG", "image"],
    ["https://example.com/blog/post", "link"],
    ["not a url", "link"],
  ])("%s -> %s", (url, kind) => {
    expect(kindFromUrl(url)).toBe(kind);
  });
});

describe("embedUrl", () => {
  it("builds players for youtube, vimeo, spotify", () => {
    expect(youtubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(embedUrl("https://youtu.be/dQw4w9WgXcQ")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedUrl("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871?autoplay=1");
    expect(embedUrl("https://open.spotify.com/intl-de/album/1DFixLWuPkv3KT3TnV35m3?si=x")).toBe(
      "https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3",
    );
    expect(embedUrl("https://example.com")).toBeNull();
    expect(embedUrl(null)).toBeNull();
  });
});

describe("splitUrlAndText", () => {
  it("pulls the URL out and keeps the rest as text", () => {
    expect(splitUrlAndText(["Check this out: Cool Lamp https://a.co/d/xyz."])).toEqual({
      url: "https://a.co/d/xyz",
      text: "Check this out: Cool Lamp",
    });
  });
  it("dedupes a URL sent as both url and text", () => {
    expect(splitUrlAndText(["https://x.com/a", "https://x.com/a"])).toEqual({ url: "https://x.com/a" });
  });
  it("decodes an encoded URL", () => {
    expect(splitUrlAndText(["https%3A%2F%2Fexample.com%2Fa"]).url).toBe("https://example.com/a");
  });
  it("plain text stays text", () => {
    expect(splitUrlAndText(["just a thought"])).toEqual({ text: "just a thought" });
  });
});

describe("parseBoardInput", () => {
  const MAX = 1024 * 1024;
  it("reads Shortcut JSON { input }", async () => {
    const req = new Request("https://k.test/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "https://open.spotify.com/track/abc", note: "gym" }),
    });
    const out = await parseBoardInput(req, MAX);
    expect(out).toMatchObject({ url: "https://open.spotify.com/track/abc", note: "gym", via: "app" });
  });
  it("reads JSON mislabelled as a form, and real form posts", async () => {
    const json = new Request("https://k.test/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: JSON.stringify({ input: "Song Title https://x.test/s" }),
    });
    expect(await parseBoardInput(json, MAX)).toMatchObject({ url: "https://x.test/s", text: "Song Title" });
    const form = new Request("https://k.test/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "url=https%3A%2F%2Fx.test%2Fa&note=hi",
    });
    expect(await parseBoardInput(form, MAX)).toMatchObject({ url: "https://x.test/a", note: "hi" });
  });
  it("reads a list input from Shortcuts", async () => {
    const req = new Request("https://k.test/api/board", {
      method: "POST",
      body: JSON.stringify({ input: ["https://a.test/1", "https://a.test/2"] }),
    });
    expect((await parseBoardInput(req, MAX)).url).toBe("https://a.test/1");
  });
  it("reads a raw image body", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#f00" } }).png().toBuffer();
    const req = new Request("https://k.test/api/board", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(png),
    });
    const out = await parseBoardInput(req, MAX);
    expect(out.image?.length).toBe(png.length);
  });
  it("reads a multipart share-target post", async () => {
    const form = new FormData();
    form.append("title", "Nice chair");
    form.append("text", "Nice chair https://shop.test/chair");
    form.append("url", "");
    form.append("file", new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" }));
    const req = new Request("https://k.test/api/board/share", { method: "POST", body: form });
    const out = await parseBoardInput(req, MAX);
    expect(out.title).toBe("Nice chair");
    expect(out.url).toBe("https://shop.test/chair");
    expect(out.image?.length).toBe(3);
  });
  it("rejects oversized images", async () => {
    const req = new Request("https://k.test/api/board", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(2048),
    });
    await expect(parseBoardInput(req, 1024)).rejects.toThrow(/too large/);
  });
  it("reads extension image saves and ignores the token param", async () => {
    const req = new Request("https://k.test/api/board?token=secret", {
      method: "POST",
      body: JSON.stringify({ imageUrl: "https://cdn.test/a.png", url: "https://site.test/page", via: "extension" }),
    });
    const out = await parseBoardInput(req, MAX);
    expect(out).toMatchObject({ imageSrc: "https://cdn.test/a.png", url: "https://site.test/page", via: "extension" });
    expect(out.text).toBeUndefined();
  });
});

describe("sniffImage", () => {
  it("recognizes formats by magic bytes, not labels", async () => {
    const jpg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).jpeg().toBuffer();
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).png().toBuffer();
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
    expect(sniffImage(jpg)).toBe("jpeg");
    expect(sniffImage(png)).toBe("png");
    expect(sniffImage(heic)).toBe("heic");
    expect(sniffImage(Buffer.from("https://example.com/not-an-image"))).toBeNull();
  });
  it("treats an unlabelled image body as an image", async () => {
    const jpg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).jpeg().toBuffer();
    const req = new Request("https://k.test/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(jpg),
    });
    const out = await parseBoardInput(req, 1024 * 1024);
    expect(out.image?.length).toBe(jpg.length);
    expect(out.text).toBeUndefined();
  });
});

describe("parsePageMeta", () => {
  it("reads og tags and resolves relative images", () => {
    const m = parsePageMeta(
      `<html><head><title>Fallback</title>
        <meta property="og:title" content="A Lamp">
        <meta property="og:site_name" content="Lamp Co">
        <meta property="og:image" content="/img/lamp.jpg">
        <meta property="product:price:amount" content="129">
        <meta property="product:price:currency" content="USD">
      </head></html>`,
      "https://lamp.test/p/1",
    );
    expect(m).toMatchObject({
      title: "A Lamp",
      siteName: "Lamp Co",
      imageSrc: "https://lamp.test/img/lamp.jpg",
      price: "$129.00",
    });
  });
  it("falls back to JSON-LD Product", () => {
    const m = parsePageMeta(
      `<html><head><title>Shop</title><script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Chair","image":["https://c.test/chair.jpg"],
         "offers":{"@type":"Offer","price":"450.00","priceCurrency":"EUR"}}]}
      </script></head></html>`,
      "https://shop.test/chair",
    );
    expect(m.isProduct).toBe(true);
    expect(m.title).toBe("Chair");
    expect(m.imageSrc).toBe("https://c.test/chair.jpg");
    expect(m.price).toBe("€450.00");
  });
});

describe("shareCaption", () => {
  it.each([
    ["Check out this item on Amazon", "Aeron Chair", undefined],
    ["Check out this video on YouTube!", "Take On Me", undefined],
    ["Listen to Blinding Lights by The Weeknd on Spotify", "Blinding Lights", undefined],
    ["Shared via TikTok", null, undefined],
    ["Aeron Chair", "Aeron Chair", undefined],
    ["Aeron Chair: Herman Miller", "Aeron Chair", "Herman Miller"],
    ["the lamp from the hotel lobby in Lisbon", "Arco Lamp", "the lamp from the hotel lobby in Lisbon"],
    ["Check out this item on Amazon: for the new office", "Desk", "for the new office"],
    [undefined, "x", undefined],
  ])("%s", (text, title, expected) => {
    expect(shareCaption(text as string | undefined, title as string | null)).toBe(expected);
  });
});
