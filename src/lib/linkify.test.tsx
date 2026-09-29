import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { extractUrls, linkify } from "./linkify";

type AnchorProps = { href: string; draggable: boolean; children: string; target: string; rel: string };
const anchors = (nodes: React.ReactNode[]) =>
  nodes.filter(isValidElement).map((n) => (n as ReactElement<AnchorProps>).props);

describe("extractUrls", () => {
  it("returns nothing for empty or link-free text", () => {
    expect(extractUrls(null)).toEqual([]);
    expect(extractUrls("")).toEqual([]);
    expect(extractUrls("call the plumber")).toEqual([]);
  });

  it("finds http(s) and www. links, normalising www. and stripping trailing punctuation", () => {
    expect(
      extractUrls("see https://a.com/x?y=1. and (www.b.org), also http://c.io!"),
    ).toEqual(["https://a.com/x?y=1", "https://www.b.org", "http://c.io"]);
  });

  it("de-duplicates repeated links", () => {
    expect(extractUrls("https://a.com https://a.com.")).toEqual(["https://a.com"]);
  });
});

describe("linkify", () => {
  it("returns the plain string when there are no links", () => {
    expect(linkify("just text")).toEqual(["just text"]);
    expect(linkify(undefined)).toEqual([]);
  });

  it("preserves surrounding text and trailing punctuation as text segments", () => {
    const out = linkify("read www.example.com/post, then https://x.dev.");
    expect(out.filter((n) => typeof n === "string")).toEqual(["read ", ",", " then ", "."]);
    const links = anchors(out);
    expect(links.map((a) => a.href)).toEqual(["https://www.example.com/post", "https://x.dev"]);
    expect(links.map((a) => a.children)).toEqual(["www.example.com/post", "https://x.dev"]);
  });

  it("renders non-draggable anchors that open in a new tab and use the click handler", () => {
    const onClick = () => {};
    const [a] = anchors(linkify("https://a.com", onClick));
    expect(a.draggable).toBe(false);
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect((a as unknown as { onClick: unknown }).onClick).toBe(onClick);
  });
});
