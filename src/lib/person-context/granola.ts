import {
  granolaFromEnv,
  granolaNoteText,
  wordMatcher,
  type GranolaClient,
  type GranolaNoteSummary,
} from "@/lib/granola";
import { CONTEXT_LIMITS } from "./types";

export type PersonMeeting = { id: string; date: string; title: string; text: string };

/** The note index is still being filled; retry shortly (the generator reports "busy"). */
export class GranolaNotReadyError extends Error {
  constructor() {
    super("Granola index is still loading");
    this.name = "GranolaNotReadyError";
  }
}

const DAY = 86_400_000;
const LIST_TTL_MS = 60 * 60_000;
type Brief = { updatedAt: string; createdAt: string; date: string; title: string; haystack: string; text: string };

// Module scope so a 200-person backfill lists (and reads each note) once per
// instance. Only titles, attendee names and summaries/notes; never transcripts.
let listed: { at: number; notes: GranolaNoteSummary[] } | null = null;
const briefs = new Map<string, Brief>();
let loggedError = false;

export function resetPersonGranolaCache() {
  listed = null;
  briefs.clear();
  loggedError = false;
}

async function noteList(client: GranolaClient, now: Date) {
  if (listed && Date.now() - listed.at < LIST_TTL_MS) return listed.notes;
  const notes = await client.listNotes({ createdAfter: new Date(now.getTime() - CONTEXT_LIMITS.threadDays * DAY) });
  const ids = new Set(notes.map((n) => n.id));
  for (const id of briefs.keys()) if (!ids.has(id)) briefs.delete(id);
  listed = { at: Date.now(), notes };
  return notes;
}

/**
 * Meetings in the last year that name this person exactly (full name, whole
 * words, case-insensitive) in the title, attendees or summary. Newest first,
 * capped per CONTEXT_LIMITS. [] without GRANOLA_API_KEY or on API errors.
 * Throws GranolaNotReadyError when the per-call fetch budget runs out before
 * every note has been read, so results never depend on how warm the cache is.
 */
export async function granolaMeetingsForPerson(
  fullName: string,
  options: { now?: Date; client?: GranolaClient | null; budgetMs?: number } = {},
): Promise<PersonMeeting[]> {
  const now = options.now ?? new Date();
  const name = fullName.trim().replace(/\s+/g, " ");
  // A lone first name would match half the calendar.
  if (name.split(" ").length < 2) return [];
  const client = options.client === undefined ? granolaFromEnv() : options.client;
  if (!client) return [];
  const deadline = Date.now() + (options.budgetMs ?? 20_000);
  try {
    const since = now.getTime() - CONTEXT_LIMITS.threadDays * DAY;
    const notes = (await noteList(client, now))
      .filter((n) => Date.parse(n.created_at) >= since)
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
    for (const n of notes) {
      if (briefs.get(n.id)?.updatedAt === n.updated_at) continue;
      if (Date.now() > deadline) throw new GranolaNotReadyError();
      const note = await client.getNote(n.id);
      const text = granolaNoteText({ ...note, transcript: null }, CONTEXT_LIMITS.maxGranolaCharsPerMeeting);
      const title = note.title?.trim() || note.calendar_event?.event_title?.trim() || "Untitled meeting";
      briefs.set(n.id, {
        updatedAt: n.updated_at,
        createdAt: n.created_at,
        date: note.calendar_event?.scheduled_start_time || n.created_at,
        title,
        haystack: [title, note.calendar_event?.event_title, ...(note.attendees ?? []).map((a) => a.name), text]
          .filter(Boolean)
          .join("\n"),
        text,
      });
    }
    const matcher = wordMatcher([name]);
    if (!matcher) return [];
    return notes
      .flatMap((n) => {
        const brief = briefs.get(n.id);
        return brief && matcher.test(brief.haystack) ? [{ id: n.id, date: brief.date, title: brief.title, text: brief.text }] : [];
      })
      .slice(0, CONTEXT_LIMITS.maxGranolaMeetings);
  } catch (error) {
    if (error instanceof GranolaNotReadyError) throw error;
    if (!loggedError) {
      loggedError = true;
      console.error("person context: Granola unavailable, continuing without meetings");
    }
    return [];
  }
}
