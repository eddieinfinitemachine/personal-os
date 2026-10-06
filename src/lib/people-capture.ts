// Contacts → CRM auto-add. Pure: parses the Mac worker's cards, normalises
// them and decides create vs skip against the owner's existing people. The
// route (src/app/api/capture/people/route.ts) does the database work. Card
// birthdays also fill in existing people (planBirthdayFill, route .../birthdays).
import { parseBirthday } from "@/lib/birthday";
import { IntakeError } from "@/lib/dating-intake/contracts";

export const PEOPLE_CAPTURE_LIMITS = { maxBodyBytes: 200 * 1024, maxPeople: 200, maxHandles: 20, maxField: 200 } as const;
export const CONTACTS_TAG = "from-contacts";
export const contactsExternalId = (cardId: string) => `contacts:${cardId}`;

export type ContactCard = {
  cardId: string;
  firstName: string;
  lastName: string | null;
  company: string | null;
  phones: string[];
  emails: string[];
  createdAt: string | null;
  /** YYYY-MM-DD; year 1604 when the card has no year. */
  birthday: string | null;
};
export type ExistingPerson = {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  externalId: string | null;
  archived: boolean;
};
export type SkipReason = "duplicate-card" | "no-first-name" | "no-phone-or-email" | "business" | "exists" | "phone-match" | "email-match" | "name-match";
export type PersonDraft = {
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  tags: string[];
  externalId: string;
  birthday: Date | null;
  lastInteractionAt: null;
  position: number;
};
export type CapturePlan = {
  create: { cardId: string; data: PersonDraft }[];
  skipped: { cardId: string; reason: SkipReason }[];
};

const collapse = (s: string) => s.trim().replace(/\s+/g, " ");

/** E.164 (`+`) when the number is plausibly complete; bare digits otherwise; "" when too short. */
export function normalisePhone(raw: string): string {
  const s = raw.trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7) return "";
  if (s.startsWith("+")) return `+${digits}`;
  if (s.startsWith("00") && digits.length > 11) return `+${digits.slice(2)}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

export function normaliseEmail(raw: string): string {
  const s = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(s) ? s : "";
}

/** Last 10 digits: matches "+1 (555) 123-4567" against "555.123.4567". */
export function phoneKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : "";
}

export function nameKey(first: string, last: string | null): string {
  return collapse(`${first} ${last ?? ""}`).toLowerCase();
}

function str(value: unknown, field: string, required = false): string | null {
  if (value == null) {
    if (required) throw new IntakeError(`${field} required`);
    return null;
  }
  if (typeof value !== "string") throw new IntakeError(`${field} must be a string`);
  const s = collapse(value);
  if (s.length > PEOPLE_CAPTURE_LIMITS.maxField) throw new IntakeError(`${field} too long`);
  if (required && !s) throw new IntakeError(`${field} required`);
  return s || null;
}

function birthday(value: unknown): string | null {
  if (value == null) return null;
  if (!parseBirthday(value)) throw new IntakeError("birthday must be a YYYY-MM-DD date");
  return (value as string).trim();
}

function list(value: unknown, field: string, normalise: (s: string) => string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > PEOPLE_CAPTURE_LIMITS.maxHandles) throw new IntakeError(`${field} must be a short list`);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length > PEOPLE_CAPTURE_LIMITS.maxField) throw new IntakeError(`${field} must be strings`);
    const n = normalise(item);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Validates `{ people: [...] }` and normalises every card. Throws IntakeError (400) on a bad shape. */
export function parsePeopleCapture(body: unknown): ContactCard[] {
  const people = (body as { people?: unknown } | null)?.people;
  if (!body || typeof body !== "object" || !Array.isArray(people)) throw new IntakeError("people must be a list");
  if (people.length > PEOPLE_CAPTURE_LIMITS.maxPeople) throw new IntakeError(`At most ${PEOPLE_CAPTURE_LIMITS.maxPeople} people per request`);
  return people.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new IntakeError("Each person must be an object");
    const p = raw as Record<string, unknown>;
    const createdAt = str(p.createdAt, "createdAt");
    if (createdAt && Number.isNaN(Date.parse(createdAt))) throw new IntakeError("createdAt must be a date");
    return {
      cardId: str(p.cardId, "cardId", true)!,
      firstName: str(p.firstName, "firstName") ?? "",
      lastName: str(p.lastName, "lastName"),
      company: str(p.company, "company"),
      phones: list(p.phones, "phones", normalisePhone),
      emails: list(p.emails, "emails", normaliseEmail),
      createdAt,
      birthday: birthday(p.birthday),
    };
  });
}

function skipReason(card: ContactCard): SkipReason | null {
  if (!card.firstName) return "no-first-name";
  if (!card.phones.length && !card.emails.length) return "no-phone-or-email";
  if (!card.lastName && card.company && card.company.toLowerCase() === card.firstName.toLowerCase()) return "business";
  return null;
}

/**
 * Create vs skip for each card, in order. Skip when the card is junk (no first
 * name, no phone and no email, or a business card), or when the owner already
 * has it: same externalId, any phone matching on its last 10 digits, any email,
 * or the same full name on an active person. Cards created earlier in the batch
 * count as existing, so one request never creates the same person twice.
 */
export function planPeopleCapture(cards: ContactCard[], existing: ExistingPerson[]): CapturePlan {
  const externalIds = new Set(existing.map((p) => p.externalId).filter(Boolean));
  const phones = new Set(existing.map((p) => (p.phone ? phoneKey(p.phone) : "")).filter(Boolean));
  const emails = new Set(existing.map((p) => (p.email ? p.email.trim().toLowerCase() : "")).filter(Boolean));
  const names = new Set(existing.filter((p) => !p.archived).map((p) => nameKey(p.firstName, p.lastName)));
  const seenCards = new Set<string>();
  const plan: CapturePlan = { create: [], skipped: [] };

  for (const card of cards) {
    const externalId = contactsExternalId(card.cardId);
    const reason: SkipReason | null = seenCards.has(card.cardId)
      ? "duplicate-card"
      : (skipReason(card) ??
        (externalIds.has(externalId)
          ? "exists"
          : card.phones.some((p) => phones.has(phoneKey(p)))
            ? "phone-match"
            : card.emails.some((e) => emails.has(e))
              ? "email-match"
              : names.has(nameKey(card.firstName, card.lastName))
                ? "name-match"
                : null));
    seenCards.add(card.cardId);
    if (reason) {
      plan.skipped.push({ cardId: card.cardId, reason });
      continue;
    }
    plan.create.push({
      cardId: card.cardId,
      data: {
        firstName: card.firstName,
        lastName: card.lastName,
        phone: card.phones[0] ?? null,
        email: card.emails[0] ?? null,
        company: card.company,
        tags: [CONTACTS_TAG],
        externalId,
        birthday: parseBirthday(card.birthday),
        lastInteractionAt: null,
        position: 0,
      },
    });
    externalIds.add(externalId);
    card.phones.forEach((p) => phones.add(phoneKey(p)));
    card.emails.forEach((e) => emails.add(e));
    names.add(nameKey(card.firstName, card.lastName));
  }
  return plan;
}

export type BirthdayCard = { cardId: string; phones: string[]; emails: string[]; birthday: string };
export type BirthdayHolder = { id: string; phone: string | null; email: string | null; externalId: string | null; birthday: Date | null };
export type BirthdayFillCounts = { alreadySet: number; unmatched: number; ambiguous: number; conflicting: number };
export type BirthdayFillPlan = { fill: { personId: string; birthday: Date }[]; counts: BirthdayFillCounts };

/** Validates `{ birthdays: [...] }` (a card id, a birthday and its handles). Throws IntakeError (400) on a bad shape. */
export function parseBirthdayCapture(body: unknown): BirthdayCard[] {
  const cards = (body as { birthdays?: unknown } | null)?.birthdays;
  if (!body || typeof body !== "object" || !Array.isArray(cards)) throw new IntakeError("birthdays must be a list");
  if (cards.length > PEOPLE_CAPTURE_LIMITS.maxPeople) throw new IntakeError(`At most ${PEOPLE_CAPTURE_LIMITS.maxPeople} cards per request`);
  return cards.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new IntakeError("Each card must be an object");
    const c = raw as Record<string, unknown>;
    const date = birthday(c.birthday);
    if (!date) throw new IntakeError("birthday required");
    return {
      cardId: str(c.cardId, "cardId", true)!,
      phones: list(c.phones, "phones", normalisePhone),
      emails: list(c.emails, "emails", normaliseEmail),
      birthday: date,
    };
  });
}

/**
 * Fill-only. A card's birthday goes to the one active person it matches by
 * Contacts card id, phone (last 10 digits) or email; names alone never match.
 * Skipped: a card matching several people (ambiguous), a person matched by
 * cards with different birthdays (conflicting), and anyone whose CRM birthday
 * is already set, which is never overwritten.
 */
export function planBirthdayFill(cards: BirthdayCard[], people: BirthdayHolder[]): BirthdayFillPlan {
  const external = new Map<string, string>();
  const phones = new Map<string, Set<string>>();
  const emails = new Map<string, Set<string>>();
  const index = (map: Map<string, Set<string>>, key: string, id: string) => {
    if (key) map.set(key, (map.get(key) ?? new Set()).add(id));
  };
  for (const p of people) {
    if (p.externalId) external.set(p.externalId, p.id);
    if (p.phone) index(phones, phoneKey(p.phone), p.id);
    if (p.email) index(emails, p.email.trim().toLowerCase(), p.id);
  }
  const counts: BirthdayFillCounts = { alreadySet: 0, unmatched: 0, ambiguous: 0, conflicting: 0 };
  const proposed = new Map<string, Set<string>>();
  for (const card of cards) {
    const ids = new Set<string>();
    const own = external.get(contactsExternalId(card.cardId));
    if (own) ids.add(own);
    for (const phone of card.phones) phones.get(phoneKey(phone))?.forEach((id) => ids.add(id));
    for (const email of card.emails) emails.get(email)?.forEach((id) => ids.add(id));
    if (!ids.size) counts.unmatched++;
    else if (ids.size > 1) counts.ambiguous++;
    else index(proposed, [...ids][0], card.birthday);
  }
  const current = new Map(people.map((p) => [p.id, p.birthday]));
  const fill: BirthdayFillPlan["fill"] = [];
  for (const [personId, dates] of proposed) {
    if (current.get(personId)) counts.alreadySet++;
    else if (dates.size > 1) counts.conflicting++;
    else fill.push({ personId, birthday: parseBirthday([...dates][0])! });
  }
  return { fill, counts };
}
