import { describe, expect, it } from "vitest";
import { matchDatingContact, type DatingContact } from "./dating-contact-match";

const contact: DatingContact = { name: "Ana Reyes", first: "Ana", last: "Reyes", nick: "", org: "", phones: ["(415) 555-0134"], emails: ["ANA@example.test"] };

describe("exact local dating contact matching", () => {
  it("matches a complete name with case, spacing and canonical Unicode normalization", () => {
    expect(matchDatingContact("  ANA   REYES ", [contact])).toEqual({ status: "matched", contact: {
      name: "Ana Reyes", phones: ["+14155550134"], emails: ["ana@example.test"], instagram: null,
    } });
    expect(matchDatingContact("Zoe\u0308 Martin", [{ ...contact, name: "Zoë Martin", first: "Zoë", last: "Martin" }]).status).toBe("matched");
    expect(matchDatingContact("李 小明", [{ ...contact, name: "李 小明", first: "李", last: "小明" }]).status).toBe("matched");
  });
  it("matches explicit first and last fields without fuzzy first-name or nickname matching", () => {
    expect(matchDatingContact("Ana Reyes", [{ ...contact, name: "Reyes, Ana" }]).status).toBe("matched");
    expect(matchDatingContact("Ana", [contact]).status).toBe("insufficient-name");
    expect(matchDatingContact("Anna Reyes", [contact]).status).toBe("not-found");
    expect(matchDatingContact("A Reyes", [contact]).status).toBe("not-found");
    expect(matchDatingContact("Zoe Martin", [{ ...contact, name: "Zoë Martin", first: "Zoë", last: "Martin" }]).status).toBe("not-found");
  });
  it("deduplicates equivalent records and normalized handle order, but preserves all phones on one identity", () => {
    const one = { ...contact, phones: ["+44 20 7946 0958", "4155550134", "4155550134"] };
    const two = { ...one, name: "ANA REYES", phones: ["+14155550134", "+442079460958"] };
    expect(matchDatingContact("Ana Reyes", [one, two])).toMatchObject({ status: "matched", contact: {
      phones: ["+14155550134", "+442079460958"],
    } });
  });
  it("does not merge same-name records with different numbers, emails or identity details", () => {
    for (const other of [
      { ...contact, phones: ["4155550999"] },
      { ...contact, emails: ["other@example.test"] },
      { ...contact, org: "Another organization" },
    ]) expect(matchDatingContact("Ana Reyes", [contact, other]).status).toBe("ambiguous");
  });
  it("returns Instagram only from an explicit valid contact social field", () => {
    expect(matchDatingContact("Ana Reyes", [{ ...contact, instagram: "@ana.reyes" }])).toMatchObject({ status: "matched", contact: { instagram: "ana.reyes" } });
    expect(matchDatingContact("Ana Reyes", [{ ...contact, socialUrls: { instagram: "https://instagram.com/ana.reyes/" } }])).toMatchObject({ status: "matched", contact: { instagram: "ana.reyes" } });
    expect(matchDatingContact("Ana Reyes", [{ ...contact, instagram: "ana.reyes", socialUrls: { instagram: "someone.else" } }]).status).toBe("ambiguous");
  });
  it("preserves an explicit international country code even with ten total digits", () => {
    expect(matchDatingContact("Ana Reyes", [{ ...contact, phones: ["+354 123 4567"] }]))
      .toMatchObject({ status: "matched", contact: { phones: ["+3541234567"] } });
  });
  it("does not turn extensions, short numbers or malformed email values into import handles", () => {
    expect(matchDatingContact("Ana Reyes", [{ ...contact, phones: ["5550134", "4155550134 ext 12", "+0 12345678"], emails: ["@instagram", "not an@email.test", "person@example.test"] }]))
      .toMatchObject({ status: "matched", contact: { phones: [], emails: ["person@example.test"] } });
  });
});
