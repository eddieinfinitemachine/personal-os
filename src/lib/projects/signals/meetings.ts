// Meetings as /projects evidence: Granola notes and Google Calendar events
// with other people, over the last 14 days plus the coming week (upcoming
// events feed the "Next:" lines). A Granola note replaces the calendar event
// of the same meeting, since it is richer. Every meeting passes the privacy
// gate; Granola notes are gated on their title before the note is fetched.

import { getGoogleAccessToken } from "@/lib/google";
import type { GranolaClient, GranolaNote, GranolaNoteSummary } from "@/lib/granola";
import { fromSource } from "./errors";
import type { Gate } from "./gate";
import type { SignalItem } from "./types";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const MAX_PAGES = 20;
const SAME_MEETING_MS = 30 * 60 * 1000;
const SKIPPED_EVENT_TYPES = new Set(["workingLocation", "outOfOffice", "focusTime"]);

export type CalendarAttendee = {
  email?: string;
  self?: boolean;
  resource?: boolean;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
};

export type CalendarEvent = {
  id: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  summary?: string;
  visibility?: string; // "default" | "public" | "private" | "confidential"
  htmlLink?: string;
  eventType?: string;
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: CalendarAttendee[];
};

/** Every single (recurrences expanded) event on the primary calendar in [timeMin, timeMax). */
export async function listPrimaryEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const token = await getGoogleAccessToken();
    const url = new URL(`${CALENDAR_API}/calendars/primary/events`);
    url.searchParams.set("timeMin", timeMin.toISOString());
    url.searchParams.set("timeMax", timeMax.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      throw Object.assign(new Error(`Google Calendar list events failed (${response.status})`), { status: response.status });
    }
    const data = (await response.json()) as { items?: CalendarEvent[]; nextPageToken?: string };
    events.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return events;
}

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/** A real meeting: timed, not declined, with at least one other person. */
export function isMeetingEvent(ev: CalendarEvent, mine: Set<string>): boolean {
  if (ev.status === "cancelled" || !ev.start?.dateTime) return false;
  if (ev.eventType && SKIPPED_EVENT_TYPES.has(ev.eventType)) return false;
  const attendees = ev.attendees ?? [];
  if (attendees.some((a) => a.self && a.responseStatus === "declined")) return false;
  return attendees.some((a) => !a.self && !a.resource && !!a.email && !mine.has(a.email.toLowerCase()));
}

/** Other people's email domains, sorted. */
export function otherDomains(emails: (string | null | undefined)[], mine: Set<string>): string[] {
  const out = new Set<string>();
  for (const e of emails) {
    if (!e || mine.has(e.toLowerCase())) continue;
    const d = domainOf(e);
    if (d) out.add(d);
  }
  return [...out].sort();
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

type NoteRef = { title: string; at: number };

/** Same meeting: same title (any case) and starts within 30 minutes. */
export function sameMeeting(ev: CalendarEvent, refs: NoteRef[]): boolean {
  const title = norm(ev.summary);
  const at = Date.parse(ev.start?.dateTime ?? "");
  if (!title || Number.isNaN(at)) return false;
  return refs.some((r) => r.title === title && Math.abs(r.at - at) <= SAME_MEETING_MS);
}

function noteRefs(summary: GranolaNoteSummary, full?: GranolaNote | null): NoteRef[] {
  const refs: NoteRef[] = [{ title: norm(summary.title), at: Date.parse(summary.created_at) }];
  const ce = full?.calendar_event;
  if (ce?.event_title && ce.scheduled_start_time) {
    refs.push({ title: norm(ce.event_title), at: Date.parse(ce.scheduled_start_time) });
  }
  return refs.filter((r) => r.title && !Number.isNaN(r.at));
}

export type MeetingsResult = {
  items: SignalItem[];
  /** Calendar events with other people in the window (before dedupe and the gate). */
  calendarEvents: number;
  /** Granola notes in the window, or null when Granola isn't configured. */
  granolaNotes: number | null;
};

export async function collectMeetings(opts: {
  since: Date;
  until: Date;
  now: Date;
  /** My addresses, lowercased. */
  mine: Set<string>;
  gate: Gate;
  granola: GranolaClient | null;
  /** Only notes this Granola account owns (GRANOLA_OWNER_EMAIL). */
  ownerEmail?: string | null;
  listEvents?: typeof listPrimaryEvents;
}): Promise<MeetingsResult> {
  const { since, until, now, mine, gate, granola } = opts;
  const owner = opts.ownerEmail?.trim().toLowerCase();
  const items: SignalItem[] = [];

  // Granola first: its notes decide which calendar events are duplicates.
  const refs: NoteRef[] = [];
  let granolaNotes: number | null = null;
  if (granola) {
    const listed = await fromSource("granola", () => granola.listNotes({ createdAfter: since }));
    const notes = listed.filter((n) => !owner || n.owner?.email?.toLowerCase() === owner);
    granolaNotes = notes.length;
    for (const n of notes) refs.push(...noteRefs(n));
    const titleOk = notes.filter((n) => !gate.excludes({ title: n.title, granolaId: n.id }));
    // The client spaces requests itself, so these can all be in flight at once.
    const fetched = await fromSource("granola", () =>
      Promise.all(
        titleOk.map((n) =>
          granola.getNote(n.id).catch((e) => {
            // A note deleted since it was listed is simply gone.
            if ((e as { status?: number }).status === 404) return null;
            throw e;
          }),
        ),
      ),
    );
    for (const [i, note] of fetched.entries()) {
      if (!note) continue;
      refs.push(...noteRefs(titleOk[i], note));
      const summary = note.summary_text?.trim() || note.summary_markdown?.trim() || null;
      const myNotes = note.private_notes_text?.trim() || note.private_notes_markdown?.trim() || null;
      const attendees = (note.attendees ?? []).map((a) => a.email);
      const title = note.title?.trim() || note.calendar_event?.event_title?.trim() || "(untitled)";
      if (gate.excludes({ title, text: [summary, myNotes].filter(Boolean).join("\n"), emails: attendees, granolaId: note.id })) {
        continue;
      }
      const start = note.calendar_event?.scheduled_start_time;
      items.push({
        ref: `granola:${note.id}`,
        kind: "meeting",
        title,
        at: new Date(start && !Number.isNaN(Date.parse(start)) ? start : note.created_at).toISOString(),
        url: note.web_url?.startsWith("https://") ? note.web_url : null,
        detail: summary,
        domains: otherDomains(attendees, mine),
      });
    }
  }

  const events = (await fromSource("calendar", () => (opts.listEvents ?? listPrimaryEvents)(since, until))).filter((ev) =>
    isMeetingEvent(ev, mine),
  );
  for (const ev of events) {
    // Dropped against every listed note, excluded ones included, so a private
    // meeting's calendar entry doesn't get in through the back door.
    if (sameMeeting(ev, refs)) continue;
    const attendees = (ev.attendees ?? []).filter((a) => !a.self).map((a) => a.email);
    const title = ev.summary?.trim() || "(untitled)";
    const isPrivate = ev.visibility === "private" || ev.visibility === "confidential";
    if (gate.excludes({ title, emails: attendees, private: isPrivate })) continue;
    const at = new Date(ev.start!.dateTime!);
    items.push({
      ref: `gcal:${ev.id}`,
      kind: "meeting",
      title,
      at: at.toISOString(),
      url: ev.htmlLink?.startsWith("https://") ? ev.htmlLink : null,
      upcoming: at.getTime() > now.getTime(),
      series: ev.recurringEventId ?? null,
      domains: otherDomains(attendees, mine),
    });
  }

  return { items, calendarEvents: events.length, granolaNotes };
}
