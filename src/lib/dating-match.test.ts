import { describe, expect, it } from "vitest";
import { LIKELY_MATCH, editDistance, foldName, nameScore, rankByName } from "@/lib/dating-match";

const people = [
  { id: "1", name: "Maria Chen" },
  { id: "2", name: "Margaux Forciene" },
  { id: "3", name: "Margot Langman" },
  { id: "4", name: "Zoe Park" },
  { id: "5", name: "Ana" },
  { id: "6", name: "Ana Lopez" },
];

describe("foldName", () => {
  it("lowercases, folds accents and punctuation", () => {
    expect(foldName("  Zoë  O'Brien-Smith ")).toBe("zoe o brien smith");
  });
});

describe("editDistance", () => {
  it("counts insertions, deletions and substitutions", () => {
    expect(editDistance("margo", "margot")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("same", "same")).toBe(0);
  });
});

describe("nameScore", () => {
  it("is 1 for the same name, ignoring case, spacing and accents", () => {
    expect(nameScore("zoe  park", "Zoë Park")).toBe(1);
  });
  it("scores prefixes and near-spellings as likely", () => {
    expect(nameScore("Margo", "Margot Langman")).toBeGreaterThanOrEqual(LIKELY_MATCH);
    expect(nameScore("Margo", "Margaux Forciene")).toBeGreaterThanOrEqual(LIKELY_MATCH);
    expect(nameScore("Kat", "Katherine")).toBeGreaterThanOrEqual(LIKELY_MATCH);
    expect(nameScore("Ana", "Anna")).toBeGreaterThanOrEqual(LIKELY_MATCH);
  });
  it("scores unrelated names low", () => {
    expect(nameScore("Margo", "Zoe Park")).toBeLessThan(LIKELY_MATCH);
    expect(nameScore("", "Zoe")).toBe(0);
  });
});

describe("rankByName", () => {
  it("puts the Margots first for Margo, closest spelling on top", () => {
    const ranked = rankByName("Margo", people).map((p) => p.name);
    expect(ranked.slice(0, 2)).toEqual(["Margot Langman", "Margaux Forciene"]);
    expect(ranked[2]).toBe("Maria Chen");
  });
  it("prefers the exact name over a longer one", () => {
    expect(rankByName("Ana", people)[0].name).toBe("Ana");
    expect(rankByName("ana lopez", people)[0].name).toBe("Ana Lopez");
  });
  it("keeps everyone and breaks ties alphabetically", () => {
    const ranked = rankByName("Xyz", people);
    expect(ranked).toHaveLength(people.length);
  });
});
