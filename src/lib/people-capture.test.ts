import { describe, expect, it } from "vitest";
import { IntakeError } from "@/lib/dating-intake/contracts";
import {
  nameKey, normaliseEmail, normalisePhone, parsePeopleCapture, phoneKey, planPeopleCapture,
  PEOPLE_CAPTURE_LIMITS, type ContactCard, type ExistingPerson,
} from "./people-capture";

const card = (extra: Partial<ContactCard> = {}): ContactCard => ({
  cardId: "A1:ABPerson", firstName: "Avery", lastName: "Example", company: null,
  phones: ["+15551234567"], emails: [], createdAt: null, ...extra,
});
const person = (extra: Partial<ExistingPerson> = {}): ExistingPerson => ({
  id: "p1", firstName: "Blake", lastName: "Sample", phone: null, email: null, externalId: null, archived: false, ...extra,
});
const reasons = (cards: ContactCard[], existing: ExistingPerson[] = []) =>
  planPeopleCapture(cards, existing).skipped.map((s) => s.reason);

describe("normalisation", () => {
  it("phones → E.164 where possible, else digits", () => {
    expect(normalisePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalisePhone("1 555 123 4567")).toBe("+15551234567");
    expect(normalisePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalisePhone("0044 20 7946 0958")).toBe("+442079460958");
    expect(normalisePhone("020 7946 0958")).toBe("02079460958");
    expect(normalisePhone("12345")).toBe("");
  });
  it("emails lowercase and trimmed, junk dropped", () => {
    expect(normaliseEmail("  Avery@Example.COM ")).toBe("avery@example.com");
    expect(normaliseEmail("not an email")).toBe("");
  });
  it("phone key is the last 10 digits; name key collapses case and whitespace", () => {
    expect(phoneKey("+1 (555) 123-4567")).toBe(phoneKey("555.123.4567"));
    expect(nameKey("  Avery ", "  Example  Jr ")).toBe("avery example jr");
    expect(nameKey("Avery", null)).toBe("avery");
  });
});

describe("parsePeopleCapture", () => {
  it("trims and normalises every field, dropping blank and duplicate handles", () => {
    const [c] = parsePeopleCapture({ people: [{ cardId: " A1 ", firstName: " Avery  ", lastName: "", company: " Example Co ", phones: ["555-123-4567", "(555) 123 4567", "12"], emails: ["A@Example.com", "a@example.com"], createdAt: "2026-09-29T10:00:00Z" }] });
    expect(c).toEqual({ cardId: "A1", firstName: "Avery", lastName: null, company: "Example Co", phones: ["+15551234567"], emails: ["a@example.com"], createdAt: "2026-09-29T10:00:00Z" });
  });
  it("rejects bad shapes and oversized batches", () => {
    const bad = [null, {}, { people: "x" }, { people: [{}] }, { people: [{ cardId: 1 }] }, { people: [{ cardId: "a", phones: "x" }] }, { people: [{ cardId: "a", createdAt: "nope" }] }, { people: Array.from({ length: PEOPLE_CAPTURE_LIMITS.maxPeople + 1 }, (_, i) => ({ cardId: `c${i}` })) }];
    for (const body of bad) expect(() => parsePeopleCapture(body)).toThrow(IntakeError);
    expect(parsePeopleCapture({ people: [] })).toEqual([]);
  });
});

describe("planPeopleCapture", () => {
  it("creates with the CRM shape", () => {
    const plan = planPeopleCapture([card({ company: "Example Co", phones: ["+15551234567", "+15550000000"], emails: ["avery@example.com"] })], []);
    expect(plan.skipped).toEqual([]);
    expect(plan.create).toEqual([{ cardId: "A1:ABPerson", data: {
      firstName: "Avery", lastName: "Example", phone: "+15551234567", email: "avery@example.com", company: "Example Co",
      tags: ["from-contacts"], externalId: "contacts:A1:ABPerson", lastInteractionAt: null, position: 0,
    } }]);
  });
  it("skips junk cards", () => {
    expect(reasons([card({ firstName: "" })])).toEqual(["no-first-name"]);
    expect(reasons([card({ phones: [], emails: [] })])).toEqual(["no-phone-or-email"]);
    expect(reasons([card({ firstName: "Example Co", lastName: null, company: "example co" })])).toEqual(["business"]);
    // Organisation alone is not a business card when the names differ, or with a last name.
    expect(reasons([card({ lastName: null, company: "Example Co" })])).toEqual([]);
    expect(reasons([card({ firstName: "Example", lastName: "Co", company: "Example" })])).toEqual([]);
  });
  it("skips an existing externalId", () => {
    expect(reasons([card()], [person({ externalId: "contacts:A1:ABPerson" })])).toEqual(["exists"]);
  });
  it("matches phones on the last 10 digits, including archived people", () => {
    expect(reasons([card({ phones: ["+15551234567"] })], [person({ phone: "(555) 123-4567", archived: true })])).toEqual(["phone-match"]);
    expect(reasons([card({ phones: ["+15551234567"] })], [person({ phone: "555-123-9999" })])).toEqual([]);
  });
  it("matches emails case-insensitively", () => {
    expect(reasons([card({ phones: [], emails: ["avery@example.com"] })], [person({ email: " Avery@Example.com" })])).toEqual(["email-match"]);
  });
  it("matches the exact full name on active people only", () => {
    expect(reasons([card()], [person({ firstName: "avery", lastName: "  EXAMPLE " })])).toEqual(["name-match"]);
    expect(reasons([card()], [person({ firstName: "Avery", lastName: "Example", archived: true })])).toEqual([]);
    expect(reasons([card()], [person({ firstName: "Avery", lastName: "Examples" })])).toEqual([]);
  });
  it("never creates twice within one batch", () => {
    const plan = planPeopleCapture([card(), card(), card({ cardId: "B2", firstName: "Blake", lastName: "Other" })], []);
    expect(plan.create.map((c) => c.cardId)).toEqual(["A1:ABPerson"]);
    expect(plan.skipped).toEqual([{ cardId: "A1:ABPerson", reason: "duplicate-card" }, { cardId: "B2", reason: "phone-match" }]);
  });
});
