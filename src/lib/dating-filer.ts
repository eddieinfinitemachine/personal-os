import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { callClaudeJSON } from "@/lib/claude";
import { guardGranolaIdentities, relationshipWindow, type IdentityPerson } from "@/lib/dating-identity";
import {
  appendLessons,
  dateContext,
  dayKey,
  freshItems,
  granolaExternalId,
  noonUTC,
  parseProposal,
  suggestionsFrom,
  withSourceLine,
  type KnownPerson,
  type Proposal,
  type ProposedPerson,
} from "@/lib/dating";

// Files a free-text note (dictated on /dating, or a Granola meeting) onto the
// people it is about. Two halves so dictation can be reviewed before saving:
// fileDatingNote asks Claude for a proposal (no writes), applyDatingProposal
// writes one. The Granola capture route runs both back to back.

export type NoteSource = "dictation" | "granola" | "journal";

// Notes longer than this are cut before prompting (a long meeting transcript).
export const NOTE_BUDGET = 40_000;

// Extra instructions when the "note" is a person's own journal (their notes
// field, written over months or years), filed by organizePersonNotes.
const JOURNAL_RULES = `This is my journal about her, written over time, not a note from today. Organize it:
- events: every date, milestone, call or conflict it describes, each on the exact date written in the text (e.g. 2025-01-31). Ignore the calendar of recent days above for these; never put a past event on today. Leave out any moment whose date the text doesn't give or clearly imply.
- remember, greenFlags, redFlags, lessons: pull them out of the text in short phrases.
- note: leave empty (the journal stays where it is). summary: empty.
- stage: set it only when the journal clearly says where it stands now (e.g. "Status: ended").`;

const SYSTEM = `You file one person's notes about their dating life. The note is free text: dictated, or from a meeting app, so expect transcription errors, filler and unrelated material.
Work out which romantic interests or dates it talks about and what it says about each. Ignore colleagues, friends, family and business meetings unless they are one of the people listed as someone being dated.
Rules:
- Never invent facts. Only record what the note actually says.
- Match names using both identity and the relationship's activity window, never name similarity alone. Transcription errors, misspellings and nicknames ("Anna" / "Ana", "Kat" / "Katherine", "Margo" / "Margot" / "Margaux") can refer to DIFFERENT listed people.
- For similar names, prefer the person active at the date being discussed. The note's date anchors current events; a clearly dated recollection uses its historical date instead. A past relationship can be discussed long after it ended. Do not move an old memory onto someone current.
- met/ended dates are explicit bounds; first/last timeline activity is only observed evidence. Unknown dates do not prove someone was inactive. When dates overlap, are missing, span multiple relationships, or do not distinguish two near-identical names, return personId null and isNew true for manual matching. Do not guess an ID, even if one name is spelled closer.
- A full name explicitly present in the ORIGINAL NOTE can identify someone regardless of the note date. Never invent or expand a surname as evidence. Set name to the name as written/heard in the note. If clearly new or ambiguous, use personId null and isNew true; Granola saves this as a suggestion, not an automatically created person.
- matchDate: the YYYY-MM-DD reference date used to distinguish similar names. Use the note date for clearly contemporary discussion. Use a historical date only when explicitly written in the note (ISO or month/day/year); use null for unclear retrospectives, vague periods or mixed dates. An ambiguous first-name-only recollection must remain unmatched.
- Resolve relative dates ("last night", "Saturday", "tomorrow") against the note's date using the calendar given. Dates are YYYY-MM-DD.
- Skip anything already in that person's existing lists, and don't log an event that is already on their timeline.
- note: a cleaned-up first-person summary of what was said about her, in my voice, keeping specifics (names, places, plans, preferences). summary: a short title for it, under 8 words.
- events: only real dates, milestones, calls or conflicts the note describes (or firmly plans). vibe 1-10 only if the note says how it felt, else null.
- stage: set it when the note says the relationship changed: started dating, became exclusive, paused, or ended (broke up, ended it, it's over). Otherwise null.
- instagram: her Instagram handle only when the note explicitly gives it ("her insta is @jane.doe", "she's jane.doe on Instagram"), without the @. Never guess one from her name. Null when the note doesn't state one or it matches the handle already listed.
Reply with ONLY a JSON object:
{"people":[{"personId":"<id or null>","name":"","matchDate":null,"isNew":false,"summary":"","note":"","remember":[],"greenFlags":[],"redFlags":[],"lessons":"","stage":"talking|dating|exclusive|paused|ended|null","instagram":null,"events":[{"kind":"date|milestone|call|conflict","title":"","occurredAt":"YYYY-MM-DD","vibe":null,"notes":""}]}]}
If nobody being dated is discussed, reply {"people":[]}.`;

const knownSelect = {
  id: true,
  name: true,
  stage: true,
  metAt: true,
  endedAt: true,
  remember: true,
  greenFlags: true,
  redFlags: true,
  lessons: true,
  instagram: true,
  // Recent timeline, so a meeting that mentions last week's date doesn't log it twice.
  events: {
    where: { kind: { not: "note" } },
    orderBy: { occurredAt: "desc" },
    take: 10,
    select: { occurredAt: true, kind: true, title: true },
  },
} satisfies Prisma.DatingPersonSelect;

export type KnownWithEvents = KnownPerson & IdentityPerson & { events?: { occurredAt: Date; kind: string; title: string }[] };

async function withActivityBounds(userId: string, people: KnownWithEvents[]): Promise<KnownWithEvents[]> {
  if (!people.length) return [];
  // All dated activity, not only the ten recent timeline entries sent below.
  // Imported note timestamps must not extend an ex's relationship window.
  const bounds = await prisma.datingEvent.groupBy({
    by: ["personId"],
    where: { userId, personId: { in: people.map((p) => p.id) }, kind: { not: "note" } },
    _min: { occurredAt: true },
    _max: { occurredAt: true },
  });
  const byPerson = new Map(bounds.map((row) => [row.personId, row]));
  return people.map((p) => ({ ...p,
    firstEventAt: byPerson.get(p.id)?._min.occurredAt ?? null,
    lastEventAt: byPerson.get(p.id)?._max.occurredAt ?? null,
  }));
}

export async function loadKnownPeople(userId: string): Promise<KnownWithEvents[]> {
  const people = await prisma.datingPerson.findMany({ where: { userId }, select: knownSelect, orderBy: { createdAt: "asc" } });
  return withActivityBounds(userId, people);
}

export async function loadKnownPerson(userId: string, id: string): Promise<KnownWithEvents | null> {
  const person = await prisma.datingPerson.findFirst({ where: { id, userId }, select: knownSelect });
  return person ? (await withActivityBounds(userId, [person]))[0] : null;
}

/**
 * Ask Claude what the note means for each person. Returns the validated
 * proposal and the note's day (YYYY-MM-DD). `personId` (already checked to be
 * the user's) attributes everything to that one person.
 */
export async function fileDatingNote(opts: {
  userId: string;
  text: string;
  occurredAt?: Date | string;
  personId?: string | null;
  source: NoteSource;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  /** Skip the DB read when the caller already has the people. */
  people?: KnownWithEvents[];
}): Promise<{ proposal: Proposal; day: string }> {
  const day = dayKey(opts.occurredAt ?? new Date());
  const people = opts.people ?? (await loadKnownPeople(opts.userId));
  const forced = opts.personId ? people.find((p) => p.id === opts.personId) : undefined;

  const roster = people.length
    ? people
        .map((p) =>
          [
            `- id ${p.id}: ${p.name}${p.stage ? ` (${p.stage})` : ""}`,
            `  ${relationshipWindow(p)}`,
            p.instagram && `  instagram: @${p.instagram}`,
            p.remember.length && `  remember: ${p.remember.join("; ")}`,
            p.greenFlags.length && `  green flags: ${p.greenFlags.join("; ")}`,
            p.redFlags.length && `  red flags: ${p.redFlags.join("; ")}`,
            p.events?.length &&
              `  timeline: ${p.events.map((e) => `${dayKey(e.occurredAt)} ${e.kind}: ${e.title}`).join("; ")}`,
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n")
    : "(nobody yet)";

  const journal = opts.source === "journal";
  const user = [
    dateContext(day),
    opts.source === "granola" && `From a Granola meeting${opts.sourceLabel ? `: "${opts.sourceLabel}"` : ""}.`,
    journal && JOURNAL_RULES,
    forced &&
      `This note is about ${forced.name} (id ${forced.id}). Attribute everything to her: return exactly one entry with that personId.`,
    `People I'm dating or have dated:\n${roster}`,
    `Note:\n${opts.text.slice(0, NOTE_BUDGET)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callClaudeJSON<unknown>({ system: SYSTEM, user, maxTokens: journal ? 8000 : 4000 });
  const automatic = opts.source === "granola" && !forced;
  const guarded = automatic ? guardGranolaIdentities(raw, people, opts.text.slice(0, NOTE_BUDGET), day) : raw;
  return { proposal: parseProposal(guarded, { people, noteDay: day, personId: forced?.id, journal, preserveUnmatched: automatic }), day };
}

export type AppliedPerson = { personId: string; name: string; created: boolean; eventIds: string[] };

/**
 * Write one proposed person: the note (kind "note") plus any events, new list
 * items, lessons and stage. Creates the person when `item.isNew`. Returns null
 * when the person isn't the user's, or when `externalId` was already filed.
 */
export async function applyProposedPerson(
  userId: string,
  item: ProposedPerson,
  opts: {
    day: string;
    source: NoteSource;
    sourceLabel?: string | null;
    sourceUrl?: string | null;
    /** Built from the person id once it is known (new people get one on create). */
    externalId?: (personId: string) => string;
    /** Day to stamp endedAt with when the stage becomes "ended" (default: `day`). */
    endedDay?: string;
  },
): Promise<AppliedPerson | null> {
  try {
    return await prisma.$transaction((tx) => applyProposedPersonInTransaction(tx, userId, item, opts));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

// Shared by standalone reviewed proposals and an atomic whole-meeting write.
async function applyProposedPersonInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  item: ProposedPerson,
  opts: Parameters<typeof applyProposedPerson>[2],
): Promise<AppliedPerson | null> {
  let person = item.personId
    ? await tx.datingPerson.findFirst({ where: { id: item.personId, userId } })
    : null;
  if (item.personId && !person) return null;
  let created = false;
  if (!person) {
    if (!item.isNew || !item.name) return null;
    person = await tx.datingPerson.create({
      data: {
        userId,
        name: item.name,
        stage: item.stage ?? "talking",
        metAt: noonUTC(opts.day),
        instagram: item.instagram,
      },
    });
    created = true;
  }

  const externalId = opts.externalId?.(person.id) ?? null;
  if (externalId && (await tx.datingEvent.findFirst({ where: { userId, externalId }, select: { id: true } }))) {
    return null;
  }

  const eventIds: string[] = [];
  const noteBody = item.note || item.summary;
  if (noteBody) {
    const note = await tx.datingEvent.create({
      data: {
        userId,
        personId: person.id,
        kind: "note",
        occurredAt: noonUTC(opts.day),
        title: (item.summary || firstWords(noteBody)).slice(0, 200),
        notes: withSourceLine(noteBody, opts.sourceLabel, opts.sourceUrl).slice(0, 20_000),
        source: opts.source,
        externalId,
      },
    });
    eventIds.push(note.id);
  }
  for (const e of item.events) {
    const ev = await tx.datingEvent.create({
      data: {
        userId,
        personId: person.id,
        kind: e.kind,
        occurredAt: noonUTC(e.occurredAt),
        title: e.title,
        notes: e.notes || null,
        vibe: e.vibe,
        source: opts.source,
        // The note carries the idempotency key; with no note, the first event does.
        externalId: !noteBody && eventIds.length === 0 ? externalId : null,
      },
    });
    eventIds.push(ev.id);
  }

  const data: Prisma.DatingPersonUpdateInput = {};
  const remember = freshItems(person.remember, item.remember);
  const greenFlags = freshItems(person.greenFlags, item.greenFlags);
  const redFlags = freshItems(person.redFlags, item.redFlags);
  if (remember.length) data.remember = [...person.remember, ...remember];
  if (greenFlags.length) data.greenFlags = [...person.greenFlags, ...greenFlags];
  if (redFlags.length) data.redFlags = [...person.redFlags, ...redFlags];
  const lessons = appendLessons(person.lessons, item.lessons);
  if (lessons !== (person.lessons?.trim() || null)) data.lessons = lessons;
  // A reviewed dictation replaces the handle (the note gave a new one);
  // unreviewed Granola filing only fills an empty one.
  if (!created && item.instagram && item.instagram !== person.instagram) {
    if (opts.source === "dictation" || !person.instagram) data.instagram = item.instagram;
  }
  if (!created && item.stage && item.stage !== person.stage) {
    data.stage = item.stage;
    if (item.stage === "ended") data.endedAt = noonUTC(opts.endedDay ?? opts.day);
  }
  if (Object.keys(data).length) await tx.datingPerson.update({ where: { id: person.id }, data });

  return { personId: person.id, name: person.name, created, eventIds };
}

// ---------------------------------------------------------------------------
// Granola meetings (the capture endpoint and the API sync share this)

export type GranolaMeeting = {
  meetingId: string;
  occurredAt: Date;
  title: string | null;
  url: string | null;
  text: string;
};

export type GranolaFiled = { meetingId: string; personId: string; name: string; eventIds: string[] };
export type GranolaSuggested = {
  meetingId: string;
  name: string;
  title: string | null;
  url: string | null;
  occurredAt: string;
  summary: string;
  note: string;
};

export type GranolaMeetingResult =
  | { status: "skipped" }
  | { status: "error"; error: string }
  | { status: "done"; filed: GranolaFiled[]; suggestions: GranolaSuggested[]; skipped: number };

/**
 * Name on the dismissed placeholder suggestion that marks a meeting Claude
 * read and found nothing in, so the sync doesn't pay for it again. Never
 * shown: /dating lists pending suggestions only.
 */
export const NOTHING_FOUND = "(nothing to file)";

// A separate marker distinguishes a fully committed meeting from legacy
// partial writes. Hidden from the pending-suggestions UI; no schema change.
const FILING_COMPLETE = "(filing complete)";

/** Only explicit completion markers prove that every person was filed. */
export async function granolaMeetingsDone(userId: string, meetingIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(meetingIds.map((m) => m.trim().slice(0, 120)).filter(Boolean))];
  if (!ids.length) return new Set();
  const markers = await prisma.datingSuggestion.findMany({
    where: { userId, meetingId: { in: ids }, status: "dismissed", name: { in: [FILING_COMPLETE, NOTHING_FOUND] } },
    select: { meetingId: true },
  });
  return new Set(markers.map((s) => s.meetingId));
}

/**
 * File one Granola meeting atomically: auto-apply known people and save new
 * people as suggestions, then commit together with a completion marker.
 * Legacy partial meetings are replayable; per-person keys preserve old writes.
 * With `markEmpty`, empty proposals also get a completion marker.
 */
export async function fileGranolaMeeting(
  userId: string,
  meeting: GranolaMeeting,
  opts: { markEmpty?: boolean } = {},
): Promise<GranolaMeetingResult> {
  const { meetingId, title, url } = meeting;
  if ((await granolaMeetingsDone(userId, [meetingId])).size) return { status: "skipped" };

  let result;
  try {
    result = await fileDatingNote({
      userId,
      text: meeting.text,
      occurredAt: meeting.occurredAt,
      source: "granola",
      sourceLabel: title,
      sourceUrl: url,
      people: await loadKnownPeople(userId),
    });
  } catch (e) {
    console.error("granola dating filing failed", meetingId, e);
    return { status: "error", error: "Claude could not file this one" };
  }

  const drafts = suggestionsFrom(result.proposal.people);
  if (!opts.markEmpty && !result.proposal.people.length) {
    return { status: "done", filed: [], suggestions: [], skipped: 0 };
  }

  return prisma.$transaction(async (tx) => {
    // Claim first inside the same transaction. Concurrent runs wait on this
    // unique key; a rollback removes the claim and lets the next run retry.
    const claim = await tx.datingSuggestion.createMany({
      data: [{
        userId, meetingId, title, url, occurredAt: noonUTC(result.day),
        name: FILING_COMPLETE, summary: "", note: "", status: "dismissed",
      }],
      skipDuplicates: true,
    });
    if (!claim.count) return { status: "skipped" };

    const suggestions: GranolaSuggested[] = [];
    if (drafts.length) {
      // Preserve existing pending, added and dismissed historical suggestions.
      const existing = new Set((await tx.datingSuggestion.findMany({
        where: { userId, meetingId, name: { in: drafts.map((d) => d.name) } },
        select: { name: true },
      })).map((s) => s.name));
      await tx.datingSuggestion.createMany({
        data: drafts.map((d) => ({ userId, meetingId, title, url, occurredAt: noonUTC(result.day), ...d })),
        skipDuplicates: true,
      });
      for (const d of drafts) {
        if (!existing.has(d.name)) suggestions.push({ meetingId, title, url, occurredAt: result.day, ...d });
      }
    }

    const filed: GranolaFiled[] = [];
    let skipped = 0;
    for (const item of result.proposal.people) {
      if (!item.personId) continue;
      const applied = await applyProposedPersonInTransaction(tx, userId, item, {
        day: result.day,
        source: "granola",
        sourceLabel: title ?? "Granola",
        sourceUrl: url,
        externalId: (personId) => granolaExternalId(meetingId, personId),
      });
      if (applied) filed.push({ meetingId, personId: applied.personId, name: applied.name, eventIds: applied.eventIds });
      else skipped++;
    }
    return { status: "done", filed, suggestions, skipped };
  }, { timeout: 30_000 });
}

function firstWords(s: string, n = 8): string {
  const words = s.split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(" ") + (words.length > n ? "…" : "");
}

/** Create a person from one reviewed suggestion. A shared name is not identity. */
export async function addSuggestion(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const s = await tx.datingSuggestion.findFirst({ where: { id, userId, status: "pending" } });
    if (!s) return null;
    // Claim the selected row atomically before creating anything. A competing
    // add/link waits, then finds it no longer pending. Failure rolls this back.
    const claimed = await tx.datingSuggestion.updateMany({ where: { id, userId, status: "pending" }, data: { status: "added" } });
    if (!claimed.count) return null;
    const person = await tx.datingPerson.create({
      data: { userId, name: s.name, stage: "talking", metAt: s.occurredAt },
    });
    await tx.datingEvent.create({ data: suggestionNote(userId, person.id, s) });
    await tx.datingSuggestion.update({ where: { id }, data: { personId: person.id } });
    return { person, filed: 1 };
  });
}

/** File only the selected suggestion onto its explicitly chosen person. */
export async function linkSuggestion(userId: string, id: string, personId: string) {
  return prisma.$transaction(async (tx) => {
    const [s, person] = await Promise.all([
      tx.datingSuggestion.findFirst({ where: { id, userId, status: "pending" } }),
      tx.datingPerson.findFirst({ where: { id: personId, userId } }),
    ]);
    if (!s || !person) return null;
    const claimed = await tx.datingSuggestion.updateMany({
      where: { id, userId, status: "pending" }, data: { status: "added", personId },
    });
    if (!claimed.count) return null;
    const { count } = await tx.datingEvent.createMany({
      data: [suggestionNote(userId, person.id, s)],
      skipDuplicates: true,
    });
    return { person, filed: count, linked: [s.id] };
  });
}

// The kind "note" event a Granola suggestion files onto a person.
function suggestionNote(
  userId: string,
  personId: string,
  p: { meetingId: string; occurredAt: Date; title: string | null; url: string | null; summary: string; note: string },
) {
  return {
    userId,
    personId,
    kind: "note",
    occurredAt: p.occurredAt,
    title: (p.summary || `From ${p.title ?? "Granola"}`).slice(0, 200),
    notes: withSourceLine(p.note || p.summary, p.title ?? "Granola", p.url).slice(0, 20_000),
    source: "granola",
    externalId: granolaExternalId(p.meetingId, personId),
  } satisfies Prisma.DatingEventUncheckedCreateInput;
}

