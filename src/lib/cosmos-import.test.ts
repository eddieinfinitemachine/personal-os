import { describe, expect, it } from "vitest";
import {
  cleanCaption,
  isItemPlan,
  normalizeUrl,
  planElement,
  tagsForElement,
  type CosmosElement,
  type CosmosExport,
} from "@/lib/cosmos-import";

const base: CosmosElement = {
  id: 1,
  type: "MediaElementTile",
  createdAt: "2025-02-10T02:09:14.812771Z",
  shareUrl: "https://www.cosmos.so/e/1",
  caption: null,
  source: null,
  media: { __typename: "StaticImage", url: "https://cdn.cosmos.so/abc", width: 1080, height: 1346 },
  websiteTitle: null,
  websiteDescription: null,
};

describe("cleanCaption", () => {
  it("strips Cosmos's <n> markup and collapses whitespace", () => {
    expect(cleanCaption("<n>Cake</n> electric motorcycles at the  <n>Tokyo Motorcycle Show</n>.")).toBe(
      "Cake electric motorcycles at the Tokyo Motorcycle Show.",
    );
  });
  it("returns null for empty captions", () => {
    expect(cleanCaption("")).toBeNull();
    expect(cleanCaption("  ")).toBeNull();
    expect(cleanCaption(null)).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("adds https to scheme-less URLs", () => {
    expect(normalizeUrl("youtube.com/watch?v=UbSAUYS8nIY")).toBe("https://youtube.com/watch?v=UbSAUYS8nIY");
    expect(normalizeUrl("instagram.com/oxmanofficial/")).toBe("https://instagram.com/oxmanofficial/");
  });
  it("keeps real URLs and rejects junk", () => {
    expect(normalizeUrl("https://www.are.na/block/1")).toBe("https://www.are.na/block/1");
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("javascript://x.com/alert(1)")).toBeNull();
  });
});

describe("tagsForElement", () => {
  const exp: CosmosExport = {
    clusters: [
      { id: 10, name: "Graphic Tees" },
      { id: 11, name: "Unsorted Elements" },
      { id: 12, name: " motion " },
      { id: 13, name: "Broken" },
    ],
    elements: [],
    membership: { "10": [1, 2], "11": [1], "12": [1], "13": null },
  };
  it("lists the collections an element is in, skipping the unfiled bucket", () => {
    expect(tagsForElement(exp, 1)).toEqual(["Graphic Tees", "motion"]);
    expect(tagsForElement(exp, 2)).toEqual(["Graphic Tees"]);
    expect(tagsForElement(exp, 3)).toEqual([]);
  });
});

describe("planElement", () => {
  it("makes an image row linking back to the source, titled by the caption", () => {
    const plan = planElement({
      ...base,
      caption: "A <n>BMW CE 04</n> concept.",
      source: { url: "https://www.instagram.com/p/CqXjmNjsT_7/" },
    });
    expect(plan && isItemPlan(plan) && plan).toMatchObject({
      kind: "image",
      url: "https://www.instagram.com/p/CqXjmNjsT_7/",
      title: "A BMW CE 04 concept.",
      siteName: "instagram.com",
      imageSrc: "https://cdn.cosmos.so/abc",
      imageWidth: 1080,
      imageHeight: 1346,
    });
    expect((plan as { savedAt: Date }).savedAt.toISOString()).toBe("2025-02-10T02:09:14.812Z");
  });

  it("links uploads to their Cosmos page", () => {
    const plan = planElement(base);
    expect(plan).toMatchObject({ kind: "image", url: "https://www.cosmos.so/e/1", siteName: "cosmos.so", title: null });
  });

  it("keeps playable sources playable and pages as links", () => {
    expect(planElement({ ...base, source: { url: "https://www.youtube.com/watch?v=abcdefghijk" } })).toMatchObject({
      kind: "video",
    });
    expect(planElement({ ...base, source: { url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" } })).toMatchObject(
      { kind: "music" },
    );
    expect(
      planElement({
        ...base,
        type: "WebsiteElementTile",
        source: { url: "https://portal-brand.com/" },
        websiteTitle: "Portal® | Tools for movement",
        caption: "ignored",
      }),
    ).toMatchObject({ kind: "link", title: "Portal® | Tools for movement", siteName: "portal-brand.com" });
  });

  it("treats a picture from a plain web page as an image", () => {
    expect(planElement({ ...base, source: { url: "https://www.dezeen.com/2024/some-article/" } })).toMatchObject({
      kind: "image",
    });
  });

  it("uses the poster frame for videos and animations", () => {
    const video = planElement({
      ...base,
      media: { __typename: "Video", url: "https://cdn.cosmos.so/v.mp4", thumbnail: { url: "https://cdn.cosmos.so/poster" } },
    });
    expect(video).toMatchObject({ imageSrc: "https://cdn.cosmos.so/poster" });
    const gif = planElement({ ...base, media: { __typename: "AnimatedImage", url: "https://cdn.cosmos.so/gif" } });
    expect(gif).toMatchObject({ imageSrc: "https://cdn.cosmos.so/gif" });
  });

  it("re-resolves unrendered links and drops elements with nothing to show", () => {
    const link = planElement({ ...base, type: "BaseElementTile", media: null, source: { url: "youtube.com/watch?v=x" } });
    expect(link).toEqual({ url: "https://youtube.com/watch?v=x", savedAt: new Date("2025-02-10T02:09:14.812771Z") });
    expect(link && isItemPlan(link)).toBe(false);
    expect(planElement({ ...base, media: null })).toBeNull();
    expect(planElement({ ...base, media: { __typename: "Video", url: "x", thumbnail: null }, source: null })).toBeNull();
  });
});
