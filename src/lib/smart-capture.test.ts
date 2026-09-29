import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { isForceType, requiredTypeBlock } from "./smart-capture";

describe("requiredTypeBlock", () => {
  it("adds nothing when no type is forced", () => {
    expect(requiredTypeBlock(undefined)).toEqual([]);
  });

  it("keeps the trip and inventory blocks", () => {
    const trip = requiredTypeBlock("trip").join("\n");
    expect(trip).toContain('REQUIRED TYPE: trip');
    expect(trip).toContain('Classify this capture as "trip"');
    const inv = requiredTypeBlock("inventory", ["watch", "camera"]).join("\n");
    expect(inv).toContain('REQUIRED TYPE: asset/inventory');
    expect(inv).toContain('assetKind "inventory"');
    expect(inv).toContain("watch, camera");
    expect(requiredTypeBlock("inventory").join("\n")).toContain("(none yet)");
  });

  it.each([
    ["media", "Media"],
    ["place", "Places"],
    ["investment", "Investments"],
    ["practice", "Best practices"],
  ] as const)("pins %s to an asset of that kind", (kind, noun) => {
    const [blank, line] = requiredTypeBlock(kind);
    expect(blank).toBe("");
    expect(line).toContain(`REQUIRED TYPE: asset/${kind}`);
    expect(line).toContain(`Return type "asset" with assetKind "${kind}"`);
    expect(line).toContain(`${noun} tracker`);
  });

  it("asks media to identify the work, strip the verb and map it to status", () => {
    const line = requiredTypeBlock("media").join("\n");
    expect(line).toContain("web_search");
    expect(line).toMatch(/creator/);
    expect(line).toMatch(/releaseYear/);
    expect(line).toMatch(/genre/);
    expect(line).toContain('"Watch:"');
    expect(line).toContain('"Listen to"');
    expect(line).toContain('"watch" → "to-watch"');
    expect(line).toContain('"read" → "to-read"');
    expect(line).toContain('"listen" → "to-listen"');
  });

  it("asks places to identify the place with city and country", () => {
    const line = requiredTypeBlock("place").join("\n");
    expect(line).toContain("web_search");
    expect(line).toMatch(/city, country/);
  });

  it("reuses category hints for the new kinds when given", () => {
    expect(requiredTypeBlock("media", ["film", "book"]).join("\n")).toContain("film, book");
    expect(requiredTypeBlock("media").join("\n")).not.toContain("existing categories");
  });
});

describe("isForceType", () => {
  it("accepts the six forced types only", () => {
    for (const t of ["trip", "inventory", "media", "place", "investment", "practice"]) {
      expect(isForceType(t)).toBe(true);
    }
    for (const t of ["todo", "asset", "", null, 3]) expect(isForceType(t)).toBe(false);
  });
});
