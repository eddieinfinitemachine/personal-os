import { describe, expect, it } from "vitest";
import {
  applySubsetOrder,
  decideInitialSync,
  moveSlug,
  orderedTemplates,
  parseTrackerSlugs,
  sortByTemplateOrder,
  validateTrackerSlugs,
} from "./tracker-order";
import { TEMPLATES, type TemplateSlug } from "./templates";

describe("parseTrackerSlugs", () => {
  it("keeps known slugs in order and drops unknown/duplicate entries", () => {
    expect(parseTrackerSlugs(["media", "x", "trips", "media", 4, null])).toEqual(["media", "trips"]);
  });
  it("reads non-arrays as empty", () => {
    expect(parseTrackerSlugs(null)).toEqual([]);
    expect(parseTrackerSlugs({ media: true })).toEqual([]);
    expect(parseTrackerSlugs("media")).toEqual([]);
  });
});

describe("validateTrackerSlugs", () => {
  it("accepts known slugs, deduped", () => {
    expect(validateTrackerSlugs(["trips", "trips", "media"])).toEqual({ ok: true, value: ["trips", "media"] });
  });
  it("rejects non-arrays and unknown slugs", () => {
    expect(validateTrackerSlugs("media").ok).toBe(false);
    expect(validateTrackerSlugs(undefined).ok).toBe(false);
    expect(validateTrackerSlugs(["media", "bogus"]).ok).toBe(false);
  });
  it("caps at the template count", () => {
    const all = TEMPLATES.map((t) => t.slug);
    const r = validateTrackerSlugs([...all, ...all]);
    expect(r.ok && r.value).toEqual(all);
  });
});

describe("decideInitialSync", () => {
  it("uploads the local cache when the server has never been synced", () => {
    expect(decideInitialSync(null, ["media", "trips"])).toEqual({ kind: "upload", slugs: ["media", "trips"] });
  });
  it("does nothing when neither side has anything", () => {
    expect(decideInitialSync(null, [])).toEqual({ kind: "none" });
  });
  it("adopts the server order once it exists, even if empty", () => {
    expect(decideInitialSync(["trips", "media"], ["media", "trips"])).toEqual({
      kind: "adopt",
      slugs: ["trips", "media"],
    });
    expect(decideInitialSync([], ["media"])).toEqual({ kind: "adopt", slugs: [] });
  });
  it("does nothing when both already match", () => {
    expect(decideInitialSync(["media", "trips"], ["media", "trips"])).toEqual({ kind: "none" });
  });
});

describe("moveSlug", () => {
  const order: TemplateSlug[] = ["media", "trips", "inventory"];
  it("moves up and down", () => {
    expect(moveSlug(order, "inventory", 1)).toEqual(["media", "inventory", "trips"]);
    expect(moveSlug(order, "media", 2)).toEqual(["trips", "inventory", "media"]);
  });
  it("clamps the target index", () => {
    expect(moveSlug(order, "trips", -5)).toEqual(["trips", "media", "inventory"]);
    expect(moveSlug(order, "trips", 99)).toEqual(["media", "inventory", "trips"]);
  });
  it("returns the same array for no-ops", () => {
    expect(moveSlug(order, "media", 0)).toBe(order);
    expect(moveSlug(order, "places", 1)).toBe(order);
  });
});

describe("applySubsetOrder", () => {
  it("keeps hidden slugs in their slots", () => {
    // Print lists and the private Dating tracker aren't in the reordered subset.
    const full: TemplateSlug[] = ["media", "print-lists", "dating", "trips", "inventory"];
    expect(applySubsetOrder(full, ["inventory", "media", "trips"])).toEqual([
      "inventory",
      "print-lists",
      "dating",
      "media",
      "trips",
    ]);
  });
  it("ignores a subset that names slugs not in the list", () => {
    const full: TemplateSlug[] = ["media", "trips"];
    expect(applySubsetOrder(full, ["places", "media"])).toBe(full);
  });
});

describe("orderedTemplates", () => {
  it("returns visible templates in stored order", () => {
    const visible = TEMPLATES.filter((t) => !t.privateOnly);
    const out = orderedTemplates(["trips", "dating", "media"], visible).map((t) => t.slug);
    expect(out).toEqual(["trips", "media"]);
  });
});

describe("sortByTemplateOrder", () => {
  it("normalises a legacy add-order cache to the order the sidebar showed", () => {
    expect(sortByTemplateOrder(["print-lists", "media", "reader"])).toEqual(["reader", "media", "print-lists"]);
  });
});
