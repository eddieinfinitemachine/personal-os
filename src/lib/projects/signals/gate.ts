// The /projects privacy gate. Health, therapy, dating and family never reach
// Claude: every collected item is checked here first, on its full text (before
// any truncation), and the check over-excludes on purpose. A false positive
// costs one piece of evidence; a false negative puts a private meeting on a
// card. Only per-rule counts leave this module, never what matched.

import { prisma } from "@/lib/prisma";
import { relationshipCategory } from "@/lib/call-sheet/policy";
import { isTherapyTitle, namesToMatch, selectMeeting, wordMatcher } from "@/lib/granola";

export const EXCLUSION_RULES = [
  "private",
  "dating-record",
  "excluded-meeting",
  "contact",
  "therapy",
  "dating",
  "health",
  "family",
] as const;
export type ExclusionRule = (typeof EXCLUSION_RULES)[number];
export type ExclusionCounts = Record<ExclusionRule, number>;

export const HEALTH_WORDS = [
  "health",
  "mental health",
  "doctor",
  "dr",
  "physician",
  "pcp",
  "dentist",
  "dental",
  "orthodontist",
  "dermatologist",
  "therapist",
  "therapy",
  "psychiatrist",
  "psychologist",
  "counseling",
  "counselor",
  "medical",
  "medication",
  "meds",
  "prescription",
  "pharmacy",
  "clinic",
  "hospital",
  "urgent care",
  "surgery",
  "surgeon",
  "diagnosis",
  "checkup",
  "check-up",
  "blood test",
  "bloodwork",
  "blood work",
  "lab results",
  "mri",
  "x-ray",
  "ultrasound",
  "vaccine",
  "vaccination",
  "flu shot",
];

export const FAMILY_WORDS = [
  "family",
  "mom",
  "mommy",
  "dad",
  "daddy",
  "mother",
  "father",
  "parents",
  "sister",
  "brother",
  "sibling",
  "siblings",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "grandparents",
  "aunt",
  "uncle",
  "cousin",
  "niece",
  "nephew",
  "wife",
  "husband",
  "son",
  "daughter",
  "kids",
  "baby",
  "in-laws",
  "mother-in-law",
  "father-in-law",
  "wedding",
  "funeral",
  "shiva",
  "bris",
  "seder",
  "passover",
  "thanksgiving",
];

export type GateContext = {
  /** Everyone on /dating: full and first names. */
  datingNames: string[];
  /** Full names of people in the family circle. */
  familyNames: string[];
  /** Dating handles and family emails, lowercased. */
  blockedEmails: Set<string>;
  /** Granola note ids that dating records were filed from. */
  datingNoteIds: Set<string>;
};

export type GateInput = {
  title?: string | null;
  /** Everything else that will be shown to Claude (summary, snippet, body), untruncated. */
  text?: string | null;
  /** Other participants' addresses. */
  emails?: (string | null | undefined)[];
  /** Marked private / confidential on the calendar. */
  private?: boolean;
  granolaId?: string | null;
  /** A todo made from this Granola note (autopilotKey granola:<noteId>:…). */
  fromNoteId?: string | null;
};

export function createGate(ctx: GateContext) {
  const counts = Object.fromEntries(EXCLUSION_RULES.map((r) => [r, 0])) as ExclusionCounts;
  const excludedNoteIds = new Set(ctx.datingNoteIds);
  const health = wordMatcher(HEALTH_WORDS)!;
  const family = wordMatcher([...FAMILY_WORDS, ...ctx.familyNames])!;

  function reason(input: GateInput): ExclusionRule | null {
    if (input.private) return "private";
    if (input.granolaId && ctx.datingNoteIds.has(input.granolaId)) return "dating-record";
    if (input.fromNoteId && excludedNoteIds.has(input.fromNoteId)) return "excluded-meeting";
    if (input.emails?.some((e) => !!e && ctx.blockedEmails.has(e.trim().toLowerCase()))) return "contact";
    if (isTherapyTitle(input.title)) return "therapy";
    const text = [input.title, input.text].filter(Boolean).join("\n");
    if (!text) return null;
    if (selectMeeting({ title: input.title, summary: input.text }, ctx.datingNames).candidate) return "dating";
    if (health.test(text)) return "health";
    if (family.test(text)) return "family";
    return null;
  }

  return {
    counts,
    /** Granola notes that were excluded (including those filed to /dating). */
    excludedNoteIds,
    /** True, and counted, when the item must not reach Claude. */
    excludes(input: GateInput): boolean {
      const rule = reason(input);
      if (!rule) return false;
      counts[rule]++;
      if (input.granolaId) excludedNoteIds.add(input.granolaId);
      return true;
    },
    /** For model output (names, status, next): would this text be excluded? Not counted. */
    matchesText(text: string | null | undefined): boolean {
      return !!text && reason({ title: text }) !== null;
    },
  };
}

export type Gate = ReturnType<typeof createGate>;

/** "granola:<noteId>:<personId>" → noteId. */
function noteIdFromExternalId(externalId: string | null): string | null {
  if (!externalId?.startsWith("granola:")) return null;
  const rest = externalId.slice("granola:".length);
  const end = rest.lastIndexOf(":");
  return (end > 0 ? rest.slice(0, end) : rest) || null;
}

/** Read-only: everything the gate needs from the database. */
export async function loadGateContext(userId: string): Promise<GateContext> {
  const [dating, people, events, suggestions, records] = await Promise.all([
    prisma.datingPerson.findMany({ where: { userId }, select: { name: true, handles: true } }),
    prisma.person.findMany({
      where: { userId, OR: [{ circles: { isEmpty: false } }, { tags: { isEmpty: false } }] },
      select: { firstName: true, lastName: true, email: true, circles: true, tags: true },
    }),
    prisma.datingEvent.findMany({ where: { userId, externalId: { startsWith: "granola:" } }, select: { externalId: true } }),
    prisma.datingSuggestion.findMany({ where: { userId, source: "granola" }, select: { meetingId: true } }),
    // The source-record pipeline: Granola notes that produced a dating event or suggestion.
    prisma.datingSourceRecord.findMany({
      where: { userId, source: "granola", OR: [{ events: { some: {} } }, { suggestions: { some: {} } }] },
      select: { externalId: true },
    }),
  ]);

  const family = people.filter((p) => relationshipCategory(p) === "family");
  const blockedEmails = new Set<string>();
  for (const handle of dating.flatMap((d) => d.handles)) {
    if (handle.includes("@")) blockedEmails.add(handle.trim().toLowerCase());
  }
  for (const p of family) if (p.email?.includes("@")) blockedEmails.add(p.email.trim().toLowerCase());

  const datingNoteIds = new Set<string>();
  for (const e of events) {
    const id = noteIdFromExternalId(e.externalId);
    if (id) datingNoteIds.add(id);
  }
  for (const s of suggestions) if (s.meetingId) datingNoteIds.add(s.meetingId);
  for (const r of records) datingNoteIds.add(r.externalId);

  return {
    datingNames: namesToMatch(dating),
    familyNames: family.filter((p) => p.lastName?.trim()).map((p) => `${p.firstName.trim()} ${p.lastName!.trim()}`),
    blockedEmails,
    datingNoteIds,
  };
}
