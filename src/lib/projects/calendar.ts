// Read-only listing of the founder's primary Google Calendar, for /projects
// meeting discovery. (src/lib/gcal.ts only writes the separate "EC" todo calendar.)

import { getGoogleAccessToken } from "@/lib/google";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const MAX_PAGES = 20;

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
