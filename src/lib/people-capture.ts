// Contacts → CRM auto-add. Pure: parses the Mac worker's cards, normalises
// them and decides create vs skip against the owner's existing people. The
// route (src/app/api/capture/people/route.ts) does the database work.
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
