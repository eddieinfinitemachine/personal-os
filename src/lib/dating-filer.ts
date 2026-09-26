import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { callClaudeJSON } from "@/lib/claude";
import {
  appendLessons,
  dateContext,
  dayKey,
  freshItems,
  granolaExternalId,
  noonUTC,
  parseProposal,
  sameName,
  withSourceLine,
  type KnownPerson,
  type Proposal,
  type ProposedPerson,
} from "@/lib/dating";

// Files a free-text note (dictated on /dating, or a Granola meeting) onto the
// people it is about. Two halves so dictation can be reviewed before saving:
// fileDatingNote asks Claude for a proposal (no writes), applyDatingProposal
// writes one. The Granola capture route runs both back to back.

export type NoteSource = "dictation" | "granola";

// Notes longer than this are cut before prompting (a long meeting transcript).
export const NOTE_BUDGET = 40_000;

const SYSTEM = `You file one person's notes about their dating life. The note is free text: dictated, or from a meeting app, so expect transcription errors, filler and unrelated material.
Work out which romantic interests or dates it talks about and what it says about each. Ignore colleagues, friends, family and business meetings unless they are one of the people listed as someone being dated.
Rules:
- Never invent facts. Only record what the note actually says.
- Match names to the listed people even with transcription errors, misspellings or nicknames ("Anna" / "Ana", "Kat" / "Katherine"). Use their id. If someone is clearly new, set personId null and isNew true.
- Resolve relative dates ("last night", "Saturday", "tomorrow") against the note's date using the calendar given. Dates are YYYY-MM-DD.
- Skip anything already in that person's existing lists, and don't log an event that is already on their timeline.
- note: a cleaned-up first-person summary of what was said about her, in my voice, keeping specifics (names, places, plans, preferences). summary: a short title for it, under 8 words.
- events: only real dates, milestones, calls or conflicts the note describes (or firmly plans). vibe 1-10 only if the note says how it felt, else null.
- stage: set it when the note says the relationship changed: started dating, became exclusive, paused, or ended (broke up, ended it, it's over). Otherwise null.
Reply with ONLY a JSON object:
{"people":[{"personId":"<id or null>","name":"","isNew":false,"summary":"","note":"","remember":[],"greenFlags":[],"redFlags":[],"lessons":"","stage":"talking|dating|exclusive|paused|ended|null","events":[{"kind":"date|milestone|call|conflict","title":"","occurredAt":"YYYY-MM-DD","vibe":null,"notes":""}]}]}
If nobody being dated is discussed, reply {"people":[]}.`;

const knownSelect = {
  id: true,
  name: true,
  stage: true,
  remember: true,
  greenFlags: true,
  redFlags: true,
  lessons: true,
  // Recent timeline, so a meeting that mentions last week's date doesn't log it twice.
  events: {
    where: { kind: { not: "note" } },
    orderBy: { occurredAt: "desc" },
    take: 10,
    select: { occurredAt: true, kind: true, title: true },
  },
} satisfies Prisma.DatingPersonSelect;

export type KnownWithEvents = KnownPerson & { events?: { occurredAt: Date; kind: string; title: string }[] };

export async function loadKnownPeople(userId: string): Promise<KnownWithEvents[]> {
  return prisma.datingPerson.findMany({ where: { userId }, select: knownSelect, orderBy: { createdAt: "asc" } });
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

  const user = [
    dateContext(day),
    opts.source === "granola" && `From a Granola meeting${opts.sourceLabel ? `: "${opts.sourceLabel}"` : ""}.`,
    forced &&
      `This note is about ${forced.name} (id ${forced.id}). Attribute everything to her: return exactly one entry with that personId.`,
    `People I'm dating or have dated:\n${roster}`,
    `Note:\n${opts.text.slice(0, NOTE_BUDGET)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callClaudeJSON<unknown>({ system: SYSTEM, user, maxTokens: 4000 });
  return { proposal: parseProposal(raw, { people, noteDay: day, personId: forced?.id }), day };
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
  },
): Promise<AppliedPerson | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      let person = item.personId
        ? await tx.datingPerson.findFirst({ where: { id: item.personId, userId } })
        : null;
      if (item.personId && !person) return null;
      let created = false;
      if (!person) {
        if (!item.isNew || !item.name) return null;
        person = await tx.datingPerson.create({
          data: { userId, name: item.name, stage: item.stage ?? "talking", metAt: noonUTC(opts.day) },
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
      if (!created && item.stage && item.stage !== person.stage) {
        data.stage = item.stage;
        if (item.stage === "ended") data.endedAt = noonUTC(opts.day);
      }
      if (Object.keys(data).length) await tx.datingPerson.update({ where: { id: person.id }, data });

      return { personId: person.id, name: person.name, created, eventIds };
    });
  } catch (e) {
    // Two runs filing the same meeting at once: the unique index catches it.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

function firstWords(s: string, n = 8): string {
  const words = s.split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(" ") + (words.length > n ? "…" : "");
}

/**
 * "Add her" on a Granola suggestion: create the person and file the meeting
 * note to her, along with every other pending suggestion with the same name
 * so all the meetings about her land. Null when the suggestion isn't the
 * user's or is no longer pending.
 */
export async function addSuggestion(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const s = await tx.datingSuggestion.findFirst({ where: { id, userId, status: "pending" } });
    if (!s) return null;
    const person = await tx.datingPerson.create({
      data: { userId, name: s.name, stage: "talking", metAt: s.occurredAt },
    });
    const pending = await tx.datingSuggestion.findMany({
      where: { userId, status: "pending", name: { equals: s.name, mode: "insensitive" } },
      orderBy: { occurredAt: "asc" },
    });
    // The equals above is exact apart from case; sameName also folds spacing.
    const same = pending.filter((p) => sameName(p.name, s.name));
    for (const p of same) {
      await tx.datingEvent.create({
        data: {
          userId,
          personId: person.id,
          kind: "note",
          occurredAt: p.occurredAt,
          title: (p.summary || `From ${p.title ?? "Granola"}`).slice(0, 200),
          notes: withSourceLine(p.note || p.summary, p.title ?? "Granola", p.url).slice(0, 20_000),
          source: "granola",
          externalId: granolaExternalId(p.meetingId, person.id),
        },
      });
    }
    await tx.datingSuggestion.updateMany({
      where: { id: { in: same.map((p) => p.id) } },
      data: { status: "added", personId: person.id },
    });
    return { person, filed: same.length };
  });
}

