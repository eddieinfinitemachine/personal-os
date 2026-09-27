import { normalizeHandle, normalizeInstagram } from "./dating";

/** Existing local Contacts export, with optional explicitly recorded social data. */
export type DatingContact = {
  name: string;
  first?: string;
  last?: string;
  nick?: string;
  org?: string;
  phones: string[];
  emails: string[];
  instagram?: string | null;
  socialUrls?: { instagram?: string | null } | null;
};
export type MatchedDatingContact = { name: string; phones: string[]; emails: string[]; instagram: string | null };
export type DatingContactMatch =
  | { status: "matched"; contact: MatchedDatingContact }
  | { status: "ambiguous" | "not-found" | "insufficient-name" };

// Preserve accents and punctuation: removing them can merge different people.
// NFKC still equates composed/decomposed Unicode and normalizes spacing forms.
const normalizeName = (value: string) => value.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
const uniqueSorted = (values: string[]) => [...new Set(values)].sort();
function phone(value: string): string | null {
  const raw = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  // No country-code guessing for short/local or unprefixed foreign numbers.
  if (!raw.startsWith("+") && !(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) return null;
  const normalized = raw.startsWith("+") ? `+${digits}` : normalizeHandle(raw);
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}
function email(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

/**
 * Exact complete names only. Multiple records may collapse only when their
 * identity fields and normalized contact data are identical. Never pool phones
 * across different same-name cards, use nickname guesses, or invent Instagram.
 */
export function matchDatingContact(name: string, contacts: readonly DatingContact[]): DatingContactMatch {
  const query = normalizeName(name);
  if (query.split(" ").filter((word) => /\p{L}/u.test(word)).length < 2) return { status: "insufficient-name" };
  const candidates = contacts.filter((contact) => normalizeName(contact.name) === query ||
    (!!contact.first?.trim() && !!contact.last?.trim() && normalizeName(`${contact.first} ${contact.last}`) === query));
  if (!candidates.length) return { status: "not-found" };

  const identities = new Map<string, MatchedDatingContact>();
  for (const contact of candidates) {
    const phones = uniqueSorted(contact.phones.map(phone).filter((p): p is string => !!p));
    const emails = uniqueSorted(contact.emails.map(email).filter((e): e is string => !!e));
    const social = uniqueSorted([contact.instagram, contact.socialUrls?.instagram]
      .map(normalizeInstagram).filter((handle): handle is string => !!handle));
    if (social.length > 1) return { status: "ambiguous" };
    const identity = JSON.stringify([
      ...[contact.name, contact.first, contact.last, contact.nick, contact.org].map((value) => normalizeName(value ?? "")),
      uniqueSorted(contact.phones.map((p) => phone(p) ?? `invalid:${normalizeName(p)}`)),
      uniqueSorted(contact.emails.map((e) => email(e) ?? `invalid:${normalizeName(e)}`)),
      social,
    ]);
    identities.set(identity, { name: contact.name.trim().replace(/\s+/gu, " "), phones, emails, instagram: social[0] ?? null });
  }
  if (identities.size !== 1) return { status: "ambiguous" };
  return { status: "matched", contact: identities.values().next().value! };
}
