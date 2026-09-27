import { prisma } from "@/lib/prisma";
import { applyProposedPerson, fileDatingNote, loadKnownPerson } from "@/lib/dating-filer";
import {
  JOURNAL_TITLE,
  describeOrganize,
  clientToday,
  journalExternalId,
  journalItem,
  journalText,
  lastEventDay,
  organizeCounts,
  pendingJournalIds,
  type OrganizeCounts,
} from "@/lib/dating";

// "Organize notes with Claude": turn a person's free-text journal (the notes
// field, e.g. the 22 people bulk-imported with only a long summary) into
// timeline events on the dates the text gives, flags, things to remember and
// lessons. Applied without review. A "From journal" note event keyed
// journal:<personId> marks it done, so a second run is a no-op.

export type OrganizeResult = {
  personId: string;
  name: string;
  status: "done" | "skipped" | "empty" | "error";
  counts: OrganizeCounts | null;
  /** "Added 4 dates, 3 flags, 2 lessons" / why nothing happened. */
  summary: string;
};

/**
 * Organize one person's notes. Null when the person isn't the user's.
 * Never rewrites the notes field; only sets the stage when Claude reads one
 * clearly and the current stage is still the default ("talking").
 */
export async function organizePersonNotes(
  userId: string,
  personId: string,
  opts: { today?: unknown } = {},
): Promise<OrganizeResult | null> {
  const person = await prisma.datingPerson.findFirst({
    where: { id: personId, userId },
    select: { id: true, name: true, stage: true, notes: true, lessons: true },
  });
  if (!person) return null;
  const base = { personId: person.id, name: person.name };
  const externalId = journalExternalId(person.id);

  if (await prisma.datingEvent.findFirst({ where: { userId, externalId }, select: { id: true } })) {
    return { ...base, status: "skipped", counts: null, summary: "Already organized" };
  }
  const text = journalText(person.notes, person.lessons);
  if (!text) return { ...base, status: "empty", counts: null, summary: "No notes to organize" };

  const known = await loadKnownPerson(userId, person.id);
  if (!known) return null;

  let filed;
  try {
    filed = await fileDatingNote({
      userId,
      text,
      occurredAt: clientToday(opts.today),
      personId: person.id,
      source: "journal",
      people: [known],
    });
  } catch (e) {
    console.error("organize notes failed", person.id, e);
    return { ...base, status: "error", counts: null, summary: "Claude could not organize these notes; try again" };
  }

  const proposed = filed.proposal.people.find((p) => p.personId === person.id);
  const item = journalItem(person, proposed);
  const counts = organizeCounts(item);
  const summary = describeOrganize(counts);
  // The marker note is always written, even when nothing was found, so the
  // person isn't sent to Claude again.
  const applied = await applyProposedPerson(
    userId,
    { ...item, summary: JOURNAL_TITLE, note: `Organized my notes about ${person.name.split(/\s+/)[0]} with Claude. ${summary}.` },
    {
      day: filed.day,
      source: "journal",
      externalId: () => externalId,
      endedDay: lastEventDay(item.events) ?? undefined,
    },
  );
  // Null here means another run filed it first (unique externalId).
  if (!applied) return { ...base, status: "skipped", counts: null, summary: "Already organized" };
  return { ...base, status: "done", counts, summary };
}

/** People (ids, oldest first) whose notes haven't been organized yet, minus `skip`. */
export async function pendingOrganize(userId: string, skip: string[] = []): Promise<string[]> {
  const [people, marked] = await Promise.all([
    prisma.datingPerson.findMany({
      where: { userId, notes: { not: null } },
      select: { id: true, notes: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.datingEvent.findMany({
      where: { userId, externalId: { startsWith: journalExternalId("") } },
      select: { externalId: true },
    }),
  ]);
  return pendingJournalIds(people, marked.map((m) => m.externalId), skip);
}

export const ORGANIZE_BATCH = 3;

/**
 * One organize-all batch: up to ORGANIZE_BATCH people, in parallel so a batch
 * takes about as long as one Claude call. `skip` holds ids that failed earlier
 * in this run so the client's loop always ends.
 */
export async function organizeBatch(userId: string, skip: string[] = [], today?: unknown) {
  const pending = await pendingOrganize(userId, skip);
  const batch = pending.slice(0, ORGANIZE_BATCH);
  const results = (await Promise.all(batch.map((id) => organizePersonNotes(userId, id, { today })))).filter(
    (r): r is OrganizeResult => r !== null,
  );
  const failed = results.filter((r) => r.status === "error").map((r) => r.personId);
  const remaining = (await pendingOrganize(userId, [...skip, ...failed])).length;
  return { done: results.filter((r) => r.status === "done").length, remaining, results, failed };
}

