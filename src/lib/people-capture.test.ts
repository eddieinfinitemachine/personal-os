import { describe, expect, it } from "vitest";
import { IntakeError } from "@/lib/dating-intake/contracts";
import {
  nameKey, normaliseEmail, normalisePhone, parseBirthdayCapture, parsePeopleCapture, phoneKey, planBirthdayFill, planPeopleCapture,
  PEOPLE_CAPTURE_LIMITS, type BirthdayCard, type BirthdayHolder, type ContactCard, type ExistingPerson,
} from "./people-capture";

const card = (extra: Partial<ContactCard> = {}): ContactCard => ({
  cardId: "A1:ABPerson", firstName: "Avery", lastName: "Example", company: null,
  phones: ["+15551234567"], emails: [], createdAt: null, birthday: null, ...extra,
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
    expect(c).toEqual({ cardId: "A1", firstName: "Avery", lastName: null, company: "Example Co", phones: ["+15551234567"], emails: ["a@example.com"], createdAt: "2026-09-29T10:00:00Z", birthday: null });
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
      tags: ["from-contacts"], externalId: "contacts:A1:ABPerson", birthday: null, lastInteractionAt: null, position: 0,
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

describe("card birthdays", () => {
  it("parses a card birthday (yearless 1604 included) and creates the person with it", () => {
    const [dated, yearless, none] = parsePeopleCapture({ people: [
      { cardId: "A1", firstName: "Avery", phones: ["5551234567"], birthday: "1990-03-05" },
      { cardId: "B2", firstName: "Blake", phones: ["5559876543"], birthday: "1604-02-29" },
      { cardId: "C3", firstName: "Casey", phones: ["5550001111"], birthday: null },
    ] });
    expect([dated.birthday, yearless.birthday, none.birthday]).toEqual(["1990-03-05", "1604-02-29", null]);
    const plan = planPeopleCapture([dated, yearless, none], []);
    expect(plan.create.map((c) => c.data.birthday?.toISOString() ?? null)).toEqual([
      "1990-03-05T00:00:00.000Z", "1604-02-29T00:00:00.000Z", null,
    ]);
    for (const birthday of ["2026-02-29", "03-05", "March 5", 19900305])
      expect(() => parsePeopleCapture({ people: [{ cardId: "A1", birthday }] })).toThrow(IntakeError);
  });
});

describe("parseBirthdayCapture", () => {
  it("normalises handles and requires a valid birthday per card", () => {
    expect(parseBirthdayCapture({ birthdays: [{ cardId: " A1 ", phones: ["(555) 123-4567"], emails: ["A@Example.com"], birthday: "1990-03-05" }] })).toEqual([
      { cardId: "A1", phones: ["+15551234567"], emails: ["a@example.com"], birthday: "1990-03-05" },
    ]);
    const bad = [null, {}, { birthdays: "x" }, { birthdays: [{ cardId: "A1" }] }, { birthdays: [{ cardId: "A1", birthday: "1990-02-30" }] }, { birthdays: [{ birthday: "1990-03-05" }] }, { birthdays: Array.from({ length: PEOPLE_CAPTURE_LIMITS.maxPeople + 1 }, (_, i) => ({ cardId: `c${i}`, birthday: "1990-03-05" })) }];
    for (const body of bad) expect(() => parseBirthdayCapture(body)).toThrow(IntakeError);
  });
});

describe("planBirthdayFill", () => {
  const holder = (id: string, extra: Partial<BirthdayHolder> = {}): BirthdayHolder => ({ id, phone: null, email: null, externalId: null, birthday: null, ...extra });
  const bday = (cardId: string, birthday: string, extra: Partial<BirthdayCard> = {}): BirthdayCard => ({ cardId, phones: [], emails: [], birthday, ...extra });
  it("fills by phone (last 10 digits), email or the Contacts card id", () => {
    const plan = planBirthdayFill(
      [
        bday("P", "1990-03-05", { phones: ["+15551234567"] }),
        bday("E", "1604-07-14", { emails: ["blake@example.com"] }),
        bday("X", "1985-12-31"),
      ],
      [holder("phone", { phone: "(555) 123-4567" }), holder("email", { email: " Blake@Example.com " }), holder("card", { externalId: "contacts:X" })],
    );
    expect(plan.fill.map((f) => [f.personId, f.birthday.toISOString().slice(0, 10)])).toEqual([
      ["phone", "1990-03-05"], ["email", "1604-07-14"], ["card", "1985-12-31"],
    ]);
    expect(plan.counts).toEqual({ alreadySet: 0, unmatched: 0, ambiguous: 0, conflicting: 0 });
  });
  it("never overwrites, never guesses, and never matches on names", () => {
    const plan = planBirthdayFill(
      [
        bday("set", "1990-03-05", { phones: ["+15550000001"] }),
        bday("shared", "1990-03-05", { phones: ["+15550000002"] }),
        bday("nobody", "1990-03-05", { phones: ["+15550000009"], emails: ["avery@example.com"] }),
        bday("twin1", "1990-03-05", { phones: ["+15550000003"] }),
        bday("twin2", "1991-04-06", { emails: ["dana@example.com"] }),
        bday("same1", "1992-05-07", { phones: ["+15550000004"] }),
        bday("same2", "1992-05-07", { emails: ["eli@example.com"] }),
      ],
      [
        holder("has", { phone: "+15550000001", birthday: new Date("1980-01-01T00:00:00Z") }),
        holder("a", { phone: "+15550000002" }),
        holder("b", { phone: "555-000-0002" }),
        holder("dana", { phone: "+15550000003", email: "dana@example.com" }),
        holder("eli", { phone: "+15550000004", email: "eli@example.com" }),
      ],
    );
    expect(plan.fill.map((f) => f.personId)).toEqual(["eli"]);
    expect(plan.counts).toEqual({ alreadySet: 1, unmatched: 1, ambiguous: 1, conflicting: 1 });
  });
});
