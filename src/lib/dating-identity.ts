import { editDistance, foldName } from "./dating-match";

export type IdentityPerson = {
  id: string;
  name: string;
  stage?: string;
  metAt?: Date | string | null;
  endedAt?: Date | string | null;
  firstEventAt?: Date | string | null;
  lastEventAt?: Date | string | null;
};

function day(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function firstDay(p: IdentityPerson): string | null {
  return [day(p.metAt), day(p.firstEventAt)].filter((d): d is string => !!d).sort()[0] ?? null;
}

/** Timeline bounds are observations, not proof the relationship began/ended there. */
export function relationshipWindow(p: IdentityPerson): string {
  const start = firstDay(p);
  const end = day(p.endedAt);
  const last = day(p.lastEventAt);
  return `activity window: ${start ?? "unknown start"} → ${end ?? (last ? `last observed ${last} (end unknown)` : "unknown end")}; met: ${day(p.metAt) ?? "unknown"}; ended: ${end ?? "unknown"}; stage: ${p.stage ?? "unknown"}`;
}

// Conservative collision detection, not an auto-matcher. Includes identical
// first names, short nicknames, small spelling errors, and Margo/Margot/Margaux.
function similarFirstNames(a: string, b: string): boolean {
  const x = foldName(a).split(" ")[0];
  const y = foldName(b).split(" ")[0];
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x) || editDistance(x, y) <= 1)) return true;
  return x.length >= 4 && y.length >= 4 && x.slice(0, 4) === y.slice(0, 4);
}
function containsWords(source: string, value: string): boolean {
  const words = foldName(value);
  return !!words && ` ${foldName(source)} `.includes(` ${words} `);
}

// Recognize only unambiguous written calendar dates. Vague periods stay for
// manual review instead of letting the model manufacture an identity date.
function explicitDays(text: string): Set<string> {
  const dates = new Set<string>();
  const add = (value: string) => { if (day(value) === value) dates.add(value); };
  for (const match of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) add(match[0]);
  const iso = (year: string, month: number, date: string) => `${year}-${String(month).padStart(2, "0")}-${date.padStart(2, "0")}`;
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) add(iso(m[3], Number(m[1]), m[2]));
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  for (const m of text.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(\d{4})\b/gi)) {
    add(iso(m[3], months.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, m[2]));
  }
  return dates;
}

/** Conflicting source dates cannot be overridden by a model's matching day. */
function supportedDay(value: unknown, text: string, noteDay: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || day(value) !== value) return null;
  const dates = explicitDays(text);
  if (dates.size > 1 || (dates.size === 1 && !dates.has(value))) return null;
  if (dates.has(value)) return value;
  if (value !== noteDay) return null;
  // A first-name-only recollection with no precise date remains unresolved.
  if (/\b(remembering|reminisc(?:e|ing)|thinking back|back then|used to|last year|(?:years?|months?) ago|old girlfriend|previous relationship|(?:last|previous|that|past)\s+(?:winter|spring|summer|autumn|fall)|(?:19|20)\d{2})\b/i.test(text)) return null;
  return value;
}

// Unknown bounds keep a rival plausible. A last observed event alone cannot
// prove the person was no longer being dated, even if their current stage ended.
function possiblyActive(p: IdentityPerson, date: string): boolean {
  const start = day(p.metAt) ? firstDay(p) : null;
  const end = day(p.endedAt);
  return (!start || start <= date) && (!end || end >= date);
}
function supportedActivity(p: IdentityPerson, date: string): boolean {
  const start = firstDay(p);
  if (!start || start > date || !possiblyActive(p, date)) return false;
  return !!day(p.endedAt) || ["talking", "dating", "exclusive"].includes(p.stage ?? "") || (day(p.lastEventAt) ?? "") >= date;
}

/**
 * Granola auto-files without review. Demote guesses among similar names before
 * parser deduplication strips facts against the wrong person. Never reassign to
 * a different ID: uncertain content is preserved for the existing Add to… flow.
 */
export function guardGranolaIdentities(raw: unknown, people: IdentityPerson[], sourceText: string, noteDay: string): unknown {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { people?: unknown }).people)) return raw;
  const list = (raw as { people: unknown[] }).people;
  return { ...raw, people: list.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const item = entry as Record<string, unknown>;
    const selected = people.find((p) => p.id === item.personId);
    if (!selected) return entry;
    const candidates = people.filter((p) => similarFirstNames(p.name, selected.name));
    if (candidates.length <= 1) return entry;
    const fullName = foldName(selected.name);
    const uniqueFullName = fullName.includes(" ") && people.filter((p) => foldName(p.name) === fullName).length === 1;
    const otherFullName = candidates.some((p) => p.id !== selected.id && foldName(p.name).includes(" ") && containsWords(sourceText, p.name));
    if (otherFullName) return { ...item, personId: null, isNew: true };
    if (uniqueFullName && containsWords(sourceText, selected.name)) return entry;
    const date = supportedDay(item.matchDate, sourceText, noteDay);
    if (date && supportedActivity(selected, date) && candidates.every((p) => p.id === selected.id || !possiblyActive(p, date))) return entry;
    return { ...item, personId: null, isNew: true };
  }) };
}
