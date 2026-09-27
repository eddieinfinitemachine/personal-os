import { describe, expect, it } from "vitest";
import { exactName, prepareDatingDraft, validLocalDay, type SavedDatingPerson } from "./dating-prepare";

const today = "2026-09-27";
const existing: SavedDatingPerson = {
  id: "owned-diana", name: "Diana Rose", stage: "ended", metAt: "2024-01-01T12:00:00Z", endedAt: "2025-06-01T12:00:00Z",
  handles: ["+14155550134"], instagram: "diana.rose", city: "Brooklyn", notes: "Saved history", remember: ["Likes jazz"],
};

describe("paragraph-first dating drafts", () => {
  it("preserves the original paragraph and leaves unknown fields blank", () => {
    const paragraph = "Diana Rose is an architect.\nI would like to remember her.";
    const { draft } = prepareDatingDraft({ name: "Diana Rose", work: "architect", notes: "Model rewrote this" }, paragraph, today);
    expect(draft).toMatchObject({ name: "Diana Rose", work: "architect", notes: paragraph, stage: null, handles: [], instagram: null, metAt: null, endedAt: null, age: null, city: null });
    expect(draft.remember).toEqual([]);
  });
  it("accepts explicitly stated contact details without guessing other handles", () => {
    const { draft, warnings } = prepareDatingDraft({ name: "Diana", handles: ["4155550134", "diana@example.com", "9995550199"], instagram: "diana.rose" }, "Diana: call (415) 555-0134 or diana@example.com. Her Instagram is @diana.rose.", today);
    expect(draft.handles).toEqual(["+14155550134", "diana@example.com"]);
    expect(draft.instagram).toBe("diana.rose");
    expect(warnings.join(" ")).toContain("Unverified");
  });
  it("rejects invented phones and Instagram even when they look plausible", () => {
    const result = prepareDatingDraft({ name: "Diana Rose", handles: ["+14155550134"], instagram: "diana.rose" }, "Diana Rose is an architect.", today);
    expect(result.draft.handles).toEqual([]);
    expect(result.draft.instagram).toBeNull();
    expect(result.warnings.join(" ")).toContain("No Instagram account lookup was performed");
  });
  it("does not treat an email domain or a date as a contact handle", () => {
    const result = prepareDatingDraft({ name: "Diana", handles: ["20260927"], instagram: "example.com" }, "Diana emailed diana@example.com on 2026-09-27.", today);
    expect(result.draft.handles).toEqual([]);
    expect(result.draft.instagram).toBeNull();
  });
  it.each(["https://instagram.com/diana.rose/", "Instagram: diana.rose"])("accepts an explicitly supplied Instagram reference: %s", (source) => {
    expect(prepareDatingDraft({ name: "Diana", instagram: "diana.rose" }, `Diana — ${source}`, today).draft.instagram).toBe("diana.rose");
  });
  it.each([
    ["We met on 2025-03-22.", "2025-03-22"],
    ["We met on March 22, 2025.", "2025-03-22"],
    ["We met on 3/22/2025.", "2025-03-22"],
    ["We met yesterday.", "2026-09-26"],
    ["We met two weeks ago.", "2026-09-13"],
  ])("grounds a meeting date in %s", (source, date) => {
    expect(prepareDatingDraft({ name: "Diana", metAt: date }, `Diana. ${source}`, today).draft.metAt).toBe(`${date}T12:00:00.000Z`);
  });
  it.each(["2025-06-01", "2026-02-30"])("refuses an invented or invalid exact date %s", (date) => {
    const result = prepareDatingDraft({ name: "Diana", stage: "ended", metAt: date }, "Diana and I dated in June 2025. It ended.", today);
    expect(result.draft.metAt).toBeNull();
    expect(result.draft.endedAt).toBeNull();
  });
  it("flags an exact owned dating name and can use its verified history", () => {
    const result = prepareDatingDraft({ name: "Diana Rose" }, "Diana Rose and I met through friends.", today, [existing]);
    expect(result.existingPerson).toEqual({ id: existing.id, name: existing.name });
    expect(result.draft).toMatchObject({ metAt: "2024-01-01T12:00:00.000Z", endedAt: "2025-06-01T12:00:00.000Z", handles: existing.handles, instagram: existing.instagram });
    expect(result.draft.notes).toBe("Diana Rose and I met through friends.");
  });
  it("does not use a similar person's private data or expand a surname", () => {
    const result = prepareDatingDraft({ name: "Diana", handles: existing.handles, instagram: existing.instagram, metAt: existing.metAt }, "Diana is an architect.", today, [existing]);
    expect(result.existingPerson).toBeUndefined();
    expect(result.draft).toMatchObject({ handles: [], instagram: null, metAt: null });
    expect(prepareDatingDraft({ name: "Diana Rose" }, "Diana is an architect.", today, [existing]).draft.name).toBe("");
  });
  it("does not enrich a first-name-only match even if the saved dating record also has only that name", () => {
    const result = prepareDatingDraft({ name: "Diana" }, "Diana is an architect.", today, [{ ...existing, name: "Diana" }]);
    expect(result.existingPerson).toBeUndefined();
    expect(result.draft).toMatchObject({ handles: [], instagram: null, metAt: null, endedAt: null, city: null, stage: null });
    expect(result.warnings.join(" ")).toContain("no saved details were copied");
  });
  it("preserves accents and punctuation when comparing identities", () => {
    expect(exactName("Zoë Rose", "Zoe Rose")).toBe(false);
    expect(exactName("Diana-Rose Lee", "Diana Rose Lee")).toBe(false);
    expect(exactName(" DIANA   Rose ", "Diana Rose")).toBe(true);
  });
  it("can use an explicit historical date from the exact person's saved notes", () => {
    const result = prepareDatingDraft({ name: "Diana Rose", metAt: "2023-03-22" }, "Diana Rose is someone I used to date.", today,
      [{ ...existing, metAt: null, notes: "We first met on March 22, 2023." }]);
    expect(result.draft.metAt).toBe("2023-03-22T12:00:00.000Z");
  });
  it("does not mistake a year range or a lookalike Instagram domain for contact information", () => {
    const result = prepareDatingDraft({ name: "Diana", handles: ["20242025"], instagram: "diana.rose" }, "Diana and I dated in 2024-2025. See https://evilinstagram.com/diana.rose.", today);
    expect(result.draft.handles).toEqual([]);
    expect(result.draft.instagram).toBeNull();
  });
  it("does not choose arbitrarily between duplicate saved names", () => {
    const result = prepareDatingDraft({ name: "Diana Rose" }, "Diana Rose is an architect.", today, [existing, { ...existing, id: "other" }]);
    expect(result.existingPerson).toBeUndefined();
    expect(result.draft.handles).toEqual([]);
    expect(result.warnings.join(" ")).toContain("More than one saved person");
  });
  it("enriches from an exact full-name saved contact when the model leaves contacts empty", () => {
    const result = prepareDatingDraft({ name: "Diana Rose", handles: [], instagram: null }, "Diana Rose is an architect.", today, [], { name: "Diana Rose", phone: "4155550134", email: "diana@example.com", instagram: "https://instagram.com/diana.rose" });
    expect(result.draft.handles).toEqual(["+14155550134", "diana@example.com"]);
    expect(result.draft.instagram).toBe("diana.rose");
    expect(result.existingPerson).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("exact full-name match");
  });
  it("refuses saved contact enrichment for a first-name-only or different name", () => {
    for (const name of ["Diana", "Diana Other"]) {
      const result = prepareDatingDraft({ name }, `${name} is an architect.`, today, [], { name: "Diana Rose", phone: "4155550134", instagram: "diana.rose" });
      expect(result.draft.handles).toEqual([]);
      expect(result.draft.instagram).toBeNull();
    }
  });
  it("validates calendar days without silently rolling dates forward", () => {
    expect(validLocalDay("2024-02-29")).toBe(true);
    expect(validLocalDay("2026-02-29")).toBe(false);
    expect(validLocalDay("2026-9-27")).toBe(false);
  });
  it("rejects a malformed model response instead of treating it as a usable draft", () => {
    expect(() => prepareDatingDraft(null, "Diana", today)).toThrow("Invalid draft");
    expect(() => prepareDatingDraft([], "Diana", today)).toThrow("Invalid draft");
  });
});
