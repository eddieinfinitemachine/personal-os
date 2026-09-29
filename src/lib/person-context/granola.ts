import {
  granolaFromEnv,
  granolaNoteText,
  wordMatcher,
  type GranolaClient,
  type GranolaNoteSummary,
} from "@/lib/granola";
import { CONTEXT_LIMITS } from "./types";

export type PersonMeeting = { id: string; date: string; title: string; text: string };

const DAY = 86_400_000;
const LIST_TTL_MS = 60 * 60_000;
type Brief = { updatedAt: string; createdAt: string; date: string; title: string; haystack: string; text: string };

// Module scope so a 200-person backfill lists (and reads each detailed note)
// once per warm instance. Only titles, attendee names and summaries/notes;
// never transcripts.
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

async function brief(client: GranolaClient, n: GranolaNoteSummary): Promise<Brief> {
  const cached = briefs.get(n.id);
  if (cached?.updatedAt === n.updated_at) return cached;
  const note = await client.getNote(n.id);
  const text = granolaNoteText({ ...note, transcript: null }, CONTEXT_LIMITS.maxGranolaCharsPerMeeting);
  const title = note.title?.trim() || note.calendar_event?.event_title?.trim() || "Untitled meeting";
  const b: Brief = {
    updatedAt: n.updated_at,
    createdAt: n.created_at,
    date: note.calendar_event?.scheduled_start_time || n.created_at,
    title,
    haystack: [title, note.calendar_event?.event_title, ...(note.attendees ?? []).map((a) => a.name), text]
      .filter(Boolean)
      .join("\n"),
    text,
  };
  briefs.set(n.id, b);
  return b;
}

/**
 * Meetings in the last year that name this person exactly (full name, whole
 * words, case-insensitive). Newest first, capped per CONTEXT_LIMITS.
 * [] without GRANOLA_API_KEY or on API errors; never throws.
 *
 * Bounded so a cold serverless instance finishes in seconds: one list call
 * (titles, whole year), details (attendees, summary, notes) only for the
 * newest `maxGranolaDetailNotes`, plus at most `maxGranolaMeetings` more for
 * older title matches so their text is real. Deterministic for a given list.
 */
export async function granolaMeetingsForPerson(
  fullName: string,
  options: { now?: Date; client?: GranolaClient | null } = {},
): Promise<PersonMeeting[]> {
  const now = options.now ?? new Date();
  const name = fullName.trim().replace(/\s+/g, " ");
  // A lone first name would match half the calendar.
  if (name.split(" ").length < 2) return [];
  const client = options.client === undefined ? granolaFromEnv() : options.client;
  if (!client) return [];
  const matcher = wordMatcher([name]);
  if (!matcher) return [];
  try {
    const since = now.getTime() - CONTEXT_LIMITS.threadDays * DAY;
    const notes = (await noteList(client, now))
      .filter((n) => Date.parse(n.created_at) >= since)
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
    const detailed = new Map<string, Brief>();
    for (const n of notes.slice(0, CONTEXT_LIMITS.maxGranolaDetailNotes)) detailed.set(n.id, await brief(client, n));
    const matches = notes
      .filter((n) => {
        const b = detailed.get(n.id);
        return b ? matcher.test(b.haystack) : matcher.test(n.title ?? "");
      })
      .slice(0, CONTEXT_LIMITS.maxGranolaMeetings);
    const out: PersonMeeting[] = [];
    for (const n of matches) {
      const b = detailed.get(n.id) ?? (await brief(client, n));
      out.push({ id: n.id, date: b.date, title: b.title, text: b.text });
    }
    return out;
  } catch {
    if (!loggedError) {
      loggedError = true;
      console.error("person context: Granola unavailable, continuing without meetings");
    }
    return [];
  }
}
