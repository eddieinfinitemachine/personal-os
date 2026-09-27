import { cleanList, isStage, normalizeHandle, normalizeInstagram, parseHandles, type Stage } from "./dating";

export type DatingDraft = {
  name: string; stage: Stage | null; handles: string[]; instagram: string | null;
  metVia: string | null; metAt: string | null; endedAt: string | null;
  age: number | null; city: string | null; work: string | null; notes: string;
  remember: string[]; greenFlags: string[]; redFlags: string[]; lessons: string | null;
};
export type SavedDatingPerson = Omit<Partial<DatingDraft>, "stage" | "notes"> & { id: string; name: string; stage?: string | null; notes?: string | null };
export type SavedContact = { name: string; phone?: string | null; email?: string | null; instagram?: unknown; city?: string | null; work?: string | null; metVia?: string | null };
export type PreparedDatingPerson = { draft: DatingDraft; warnings: string[]; existingPerson?: { id: string; name: string } };

const text = (value: unknown, max = 200): string | null => typeof value === "string" ? value.trim().slice(0, max) || null : null;
const normalizedName = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const exactName = (a: string, b: string) => !!normalizedName(a) && normalizedName(a) === normalizedName(b);
export const nameInParagraph = (paragraph: string, name: string) => !!normalizedName(name) && new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(normalizedName(name))}(?=$|[^\\p{L}\\p{N}])`, "u").test(normalizedName(paragraph));
export function validLocalDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isoDay(value: unknown): string | null {
  const valueText = text(value);
  if (!valueText || !validLocalDay(valueText.slice(0, 10))) return null;
  return valueText.length === 10 || /^\d{4}-\d{2}-\d{2}T/.test(valueText) ? valueText.slice(0, 10) : null;
}
function statedDays(paragraph: string, today: string): Set<string> {
  const days = new Set<string>();
  const add = (value: string) => { if (validLocalDay(value)) days.add(value); };
  for (const match of paragraph.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) add(match[0]);
  for (const match of paragraph.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) add(`${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  for (const match of paragraph.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/gi)) {
    add(`${match[3]}-${String(months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`);
  }
  if (validLocalDay(today)) {
    const base = new Date(`${today}T12:00:00Z`);
    const ago = (n: number) => add(new Date(base.getTime() - n * 86_400_000).toISOString().slice(0, 10));
    if (/\btoday\b/i.test(paragraph)) ago(0);
    if (/\b(yesterday|last night)\b/i.test(paragraph)) ago(1);
    for (const match of paragraph.matchAll(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?)\s+ago\b/gi)) {
      const names = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
      const n = /^\d+$/.test(match[1]) ? Number(match[1]) : names.indexOf(match[1].toLowerCase());
      ago(n * (/week/i.test(match[2]) ? 7 : 1));
    }
  }
  return days;
}
function paragraphHandles(paragraph: string): Set<string> {
  const emails = paragraph.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const phones = [...paragraph.matchAll(/\+?\d[\d(). -]{5,}\d/g)].map((m) => m[0].trim())
    .filter((value) => {
      const digits = value.replace(/\D/g, "").length;
      return digits <= 15 && (digits >= 10 || (value.startsWith("+") && digits >= 7));
    });
  return new Set([...emails, ...phones].map(normalizeHandle).filter(Boolean));
}
function explicitInstagram(paragraph: string, handle: string): boolean {
  const escaped = escapeRegex(handle);
  const end = "(?!(?:[a-z0-9_]|\\.[a-z0-9_]))";
  return new RegExp(`(?:^|[^a-z0-9._%+-])@${escaped}${end}`, "i").test(paragraph) ||
    [...paragraph.matchAll(/(?:^|[\s(])((?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s,;]+)/gi)].some((m) => normalizeInstagram(m[1].replace(/[).!?]+$/, "")) === handle) ||
    new RegExp(`\\b(?:instagram|insta|ig)\\s*(?:is|:|=)?\\s*@?${escaped}${end}`, "i").test(paragraph);
}

/** Validate model extraction against the paragraph and already owner-scoped records. No writes. */
export function prepareDatingDraft(raw: unknown, paragraph: string, today: string, people: SavedDatingPerson[] = [], contact?: SavedContact): PreparedDatingPerson {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid draft");
  const source = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const proposedName = text(source.name, 100) ?? "";
  const name = nameInParagraph(paragraph, proposedName) ? proposedName : "";
  if (!name) warnings.push("No clear name was found. Add her name before saving.");
  const matches = name ? people.filter((p) => exactName(p.name, name)) : [];
  const fullName = name.split(/\s+/).length > 1;
  const existing = matches.length === 1 && fullName ? matches[0] : undefined;
  if (matches.length && !fullName) warnings.push("A saved person has this first name. Review possible matches; no saved details were copied.");
  if (matches.length > 1) warnings.push("More than one saved person has this name. Review the existing people before adding another.");
  const savedContact = contact && name.split(/\s+/).length > 1 && exactName(contact.name, name) ? contact : undefined;
  const allowedHandles = paragraphHandles(paragraph);
  for (const handle of parseHandles(existing?.handles ?? [])) allowedHandles.add(handle);
  const contactHandles = parseHandles([savedContact?.phone, savedContact?.email].filter((v): v is string => typeof v === "string"));
  for (const handle of contactHandles) allowedHandles.add(handle);
  const proposedHandles = parseHandles(source.handles);
  const verifiedHandles = proposedHandles.filter((handle) => allowedHandles.has(handle));
  const handles = [...new Set([...verifiedHandles, ...parseHandles(existing?.handles ?? []), ...contactHandles])];
  if (verifiedHandles.length !== proposedHandles.length) warnings.push("Unverified phone numbers or emails were left blank.");
  const proposedInstagram = normalizeInstagram(source.instagram ?? existing?.instagram ?? savedContact?.instagram);
  const instagram = proposedInstagram && (explicitInstagram(paragraph, proposedInstagram) || proposedInstagram === normalizeInstagram(existing?.instagram) || proposedInstagram === normalizeInstagram(savedContact?.instagram)) ? proposedInstagram : null;
  if (proposedInstagram && !instagram) warnings.push("Instagram was not in the paragraph or a matching saved record, so it was left blank. No Instagram account lookup was performed.");
  if (savedContact && (handles.some((h) => contactHandles.includes(h)) || (instagram && instagram === normalizeInstagram(savedContact.instagram)))) {
    warnings.push("Contact details came from an exact full-name match in your saved contacts. Please review them.");
  }
  const supported = statedDays(paragraph, today);
  // Existing notes have no reliable "today" anchor, so use only their explicit dates.
  for (const day of statedDays(existing?.notes ?? "", "")) supported.add(day);
  const date = (key: "metAt" | "endedAt") => {
    const candidate = source[key] ?? existing?.[key];
    const day = isoDay(candidate);
    if (day && (day === isoDay(existing?.[key]) || supported.has(day))) return `${day}T12:00:00.000Z`;
    if (candidate) warnings.push(`${key === "metAt" ? "Meeting" : "End"} date was not grounded in an exact date, so it was left blank.`);
    return null;
  };
  const short = (key: "metVia" | "city" | "work", max: number) => text(source[key] ?? existing?.[key] ?? savedContact?.[key], max);
  const age = source.age ?? existing?.age;
  const stage = source.stage ?? existing?.stage;
  const draft: DatingDraft = {
    name, stage: isStage(stage) ? stage : null, handles, instagram,
    metVia: short("metVia", 100), metAt: date("metAt"), endedAt: date("endedAt"),
    age: typeof age === "number" && Number.isInteger(age) && age > 0 && age < 120 ? age : null,
    city: short("city", 100), work: short("work", 200), notes: paragraph,
    remember: cleanList(source.remember ?? existing?.remember ?? [], 30),
    greenFlags: cleanList(source.greenFlags ?? existing?.greenFlags ?? [], 15),
    redFlags: cleanList(source.redFlags ?? existing?.redFlags ?? [], 15),
    lessons: text(source.lessons ?? existing?.lessons, 5000),
  };
  return { draft, warnings, ...(existing ? { existingPerson: { id: existing.id, name: existing.name } } : {}) };
}
