import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { isFounderUser } from "@/lib/cron";
import { insertPrimaryEvent, type EventTime } from "@/lib/gcal";
import { isGoogleConfigured } from "@/lib/google";
import { isDateOnly } from "@/lib/utils";

export const dynamic = "force-dynamic";

const DEFAULT_TIME_ZONE = "America/New_York";
const TITLE_MAX = 300;

/**
 * Creates one event on the founder's primary Google Calendar: the ec app's
 * Schedule intent parses "lunch on sunday with erin miles" on the device and
 * posts the result here. A lunch is a real appointment, so it goes on
 * `primary`, not the "EC" todo calendar (src/lib/gcal.ts). Nobody is invited.
 *
 * Auth: the app session as a bearer (or the web cookie), or a capture token,
 * through resolveCaptureUser. Middleware lets the POST through so the route
 * decides. Founder only, since the Google credentials are the founder's.
 *
 * Body:
 *   { title: string,                 // trimmed, 1–300 characters
 *     start: string, end: string,    // RFC 3339 with an offset; end > start
 *     allDay?: boolean,              // true: YYYY-MM-DD, end exclusive
 *     timeZone?: string,             // IANA, default America/New_York
 *     notes?: string | null }        // the event's description
 *
 * 201 { id, htmlLink, title, start, end, allDay, calendar: "primary" }, with
 * start and end as Google stored them. 401, 403, 400, 503 and 502 are
 * `{ error }`; the 502 adds `detail` (Google's status and message).
 */
export async function POST(request: Request) {
  const userId = (await getCurrentUserId(request)) ?? (await resolveCaptureUser(request));
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isFounderUser(userId))) {
    return NextResponse.json({ error: "calendar writes are founder only" }, { status: 403 });
  }
  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: "google calendar not configured" }, { status: 503 });
  }

  const parsed = parseEventBody(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { title, start, end, allDay, timeZone, notes } = parsed;

  const at = (value: string): EventTime => (allDay ? { date: value } : { dateTime: value, timeZone });
  const result = await insertPrimaryEvent({
    summary: title,
    ...(notes ? { description: notes } : {}),
    start: at(start),
    end: at(end),
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "google calendar insert failed", detail: result.detail },
      { status: 502 },
    );
  }

  const { event } = result;
  return NextResponse.json(
    {
      id: event.id,
      htmlLink: event.htmlLink,
      title: event.summary ?? title,
      start: event.start?.dateTime ?? event.start?.date ?? start,
      end: event.end?.dateTime ?? event.end?.date ?? end,
      allDay,
      calendar: "primary",
    },
    { status: 201 },
  );
}

type EventBody = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone: string;
  notes: string | null;
};

function parseEventBody(body: unknown): EventBody | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const raw = body as Record<string, unknown>;

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return { error: "title required" };
  if (title.length > TITLE_MAX) return { error: `title must be ${TITLE_MAX} characters or fewer` };

  // Optional keys: null reads as absent.
  const allDay = raw.allDay ?? false;
  if (typeof allDay !== "boolean") return { error: "allDay must be a boolean" };

  const timeZone = ianaTimeZone(raw.timeZone ?? DEFAULT_TIME_ZONE);
  if (!timeZone) return { error: "timeZone must be an IANA time zone" };

  const notes = raw.notes ?? null;
  if (notes !== null && typeof notes !== "string") return { error: "notes must be a string or null" };

  let start: string;
  let end: string;
  if (allDay) {
    if (!isDateOnly(raw.start) || !isDateOnly(raw.end)) {
      return { error: "start and end must be YYYY-MM-DD for an all-day event" };
    }
    [start, end] = [raw.start, raw.end];
    if (end <= start) return { error: "end must be after start" };
  } else {
    const from = dateTime(raw.start);
    const to = dateTime(raw.end);
    if (!from || !to) return { error: "start and end must be RFC 3339 date-times" };
    if (to.ms <= from.ms) return { error: "end must be after start" };
    [start, end] = [from.value, to.value];
  }

  return { title, start, end, allDay, timeZone, notes: notes?.trim() || null };
}

// RFC 3339 date-time with a required offset. T and Z may be lower case
// (RFC 3339 §5.6); they're sent to Google upper case.
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function dateTime(input: unknown): { value: string; ms: number } | null {
  if (typeof input !== "string") return null;
  const value = input.toUpperCase();
  const match = DATE_TIME.exec(value);
  if (!match) return null;
  const [, day, hour, minute, second, offsetHour = "0", offsetMinute = "0"] = match;
  // Date.parse rolls 2026-02-30 and 24:00 over, so check the fields first.
  if (!isDateOnly(day) || +hour > 23 || +minute > 59 || +second > 59 || +offsetHour > 23 || +offsetMinute > 59) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : { value, ms };
}

// A zone name the runtime knows ("America/New_York", "UTC"), returned in its
// canonical spelling. Bare offsets like "+05:00" aren't IANA names.
const ZONE_NAME = /^[A-Za-z][\w+-]*(?:\/[\w+-]+)*$/;

function ianaTimeZone(input: unknown): string | null {
  if (typeof input !== "string" || !ZONE_NAME.test(input)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: input }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
