// Pure scan logic for the Gmail booking importer: query building, prompt
// construction, model-output validation, and duplicate detection. No I/O —
// no fetch, no prisma — so it stays trivially testable. Only imports types
// from ./google.

import type { GmailEmail } from "./google";

export const SCAN_KINDS = ["flight", "lodging", "activity", "transport", "meal", "note"] as const;

export const MAX_MESSAGES = 25;
export const PER_EMAIL_CHARS = 6000;
export const TOTAL_CHARS = 90000;

export type ScanTripContext = {
  name: string;
  destination: string | null;
  startDate: Date | null;
  endDate: Date | null;
  travelers: string[];
};

export type ExistingItemLite = {
  kind: string;
  title: string;
  startAt: Date | null;
  endAt: Date | null;
  confirmation: string | null;
  fromLocation: string | null;
  toLocation: string | null;
};

export type ScanProposal = {
  kind: string;
  title: string;
  startAt: string | null; // naive "YYYY-MM-DDTHH:MM", NOT ISO-with-Z
  endAt: string | null;
  location: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  confirmation: string | null;
  url: string | null;
  costUsd: number | null;
  notes: string | null;
  sourceSubject: string;
  sourceDate: string;
  duplicate: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Travel senders. High precision: a hit here is nearly always a real booking.
// Bare domains also match subdomains (comms.trainline.com, e.eurostar.com).
const TRAVEL_SENDERS =
  "airbnb.com OR booking.com OR expedia.com OR vrbo.com OR hotels.com OR marriott.com OR hyatt.com OR hilton.com OR ihg.com OR accor.com OR opentable.com OR resy.com OR sevenrooms.com OR exploretock.com OR reserve-noreply@google.com OR amtrak.com OR trainline.com OR eurostar.com OR raileurope.com OR sbb.ch OR trenitalia.com OR renfe.com OR viator.com OR getyourguide.com OR tripadvisor.com OR delta.com OR united.com OR aa.com OR jetblue.com OR alaskaair.com OR southwest.com OR britishairways.com OR lufthansa.com OR swiss.com OR airfrance.com OR klm.com OR emirates.com OR flysas.com OR iberia.com OR aircanada.com OR ryanair.com OR easyjet.com OR hertz.com OR avis.com OR enterprise.com OR sixt.com";

// Travel-specific subject phrases. Deliberately NOT bare "confirmation" /
// "receipt" / "booking" — in a work mailbox those match every SaaS invoice,
// payment notice and internal customer email, which then crowd real bookings
// out of the newest-first result window.
const TRAVEL_SUBJECTS =
  'subject:("e-ticket" OR "eticket" OR "boarding pass" OR "your itinerary" OR "travel itinerary" OR "booking confirmation" OR "booking reference" OR "reservation confirmed" OR "reservation is confirmed" OR "your reservation" OR "your booking" OR "your stay" OR "your flight" OR "your trip" OR "check-in opens" OR "confirmation number")';

const Q1_STOPWORDS = new Set(["the", "and", "trip", "city"]);

export function buildGmailQueries(trip: ScanTripContext): { q: string; maxResults: number }[] {
  const start = trip.startDate ?? null;
  const end = trip.endDate ?? trip.startDate ?? null;
  const now = Date.now();

  const after = Math.floor(((start ? start.getTime() : now) - 180 * DAY_MS) / 1000);
  const before = Math.floor((end ? end.getTime() + 2 * DAY_MS : now + DAY_MS) / 1000);

  const win = `after:${after} before:${before}`;
  const queries: { q: string; maxResults: number }[] = [];

  // Highest precision first — the route interleaves results round-robin, so
  // these always get slots even when a broader query matches hundreds.
  queries.push({ q: `${win} from:(${TRAVEL_SENDERS})`, maxResults: 20 });
  queries.push({ q: `${win} category:reservations`, maxResults: 10 });

  if (trip.destination) {
    const tokens = trip.destination
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !Q1_STOPWORDS.has(t.toLowerCase()))
      .map((t) => `"${t}"`);
    if (tokens.length) {
      queries.push({
        q: `${win} -category:promotions (${tokens.join(" OR ")}) (${TRAVEL_SUBJECTS})`,
        maxResults: 10,
      });
    }
  }

  queries.push({
    q: `${win} -category:promotions ${TRAVEL_SUBJECTS}`,
    maxResults: 10,
  });

  return queries;
}

// Merge per-query id lists round-robin so one broad query can't consume the
// whole message budget before a high-precision query contributes anything.
export function interleaveIds(lists: string[][], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const depth = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < depth && out.length < cap; i++) {
    for (const list of lists) {
      if (out.length >= cap) break;
      const id = list[i];
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

export function buildScanSystemPrompt(trip: ScanTripContext, today: string): string {
  const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const s = fmtDate(trip.startDate);
  const e = fmtDate(trip.endDate);
  const dates = s || e ? `${s ?? "unknown"} to ${e ?? "unknown"}` : "unknown";
  const travelers = trip.travelers.length ? trip.travelers.join(", ") : "unknown";

  return `You extract travel bookings from a batch of emails for one specific trip's itinerary.

TRIP CONTEXT
- Name: ${trip.name}
- Destination: ${trip.destination ?? "unknown"}
- Dates: ${dates}
- Travelers: ${travelers}
- Today: ${today}

The user message contains N emails, each headed \`=== EMAIL k ===\` with From/Date/Subject lines followed by the body text. They were found by a broad keyword search, so many are irrelevant to this trip.

Output ONLY a single JSON object, no prose, no markdown fences:
{
  "items": [
    {
      "emailIndex": number,
      "kind": "flight" | "lodging" | "activity" | "transport" | "meal" | "note",
      "title": string,
      "startAt": "YYYY-MM-DDTHH:MM" | null,
      "endAt": "YYYY-MM-DDTHH:MM" | null,
      "location": string | null,
      "fromLocation": string | null,
      "toLocation": string | null,
      "confirmation": string | null,
      "url": string | null,
      "costUsd": number | null,
      "notes": string | null
    }
  ]
}

RELEVANCE
- Include ONLY bookings that belong to THIS trip. When the trip dates are known, the event's date must fall inside the trip window (start−1 day .. end+1 day). When dates are unknown, require clear involvement of the destination or route.
- Skip marketing, newsletters, price alerts, check-in reminders, and "your trip starts soon" emails that merely duplicate a confirmation already present in the batch.
- Skip cancellations — and also skip whatever booking they cancelled.
- Skip bookings that belong to a different trip.
- Forwarded confirmations (Fwd:) count — parse the forwarded content inside them.

KIND MAPPING
- Flights → ONE item PER FLIGHT SEGMENT. title "<Airline> <FLIGHT#> <FROM>→<TO>" (e.g. "SWISS LX17 JFK→ZRH"). fromLocation/toLocation are airport codes. PNR/record locator in confirmation. Put layover/connection context in notes.
- Hotel / Airbnb / Vrbo → "lodging". ONE item spanning the whole stay: startAt = check-in, endAt = check-out (default 15:00 check-in / 11:00 check-out if the time is unstated). title = property name. location = street address or neighborhood + city.
- Trains / buses / ferries / airport transfers / rental cars → "transport". For rental cars, startAt = pickup, endAt = drop-off.
- Restaurant reservations → "meal". title = restaurant name, startAt = reservation time, party size in notes.
- Tours / tickets / events / classes → "activity".
- Trip-relevant but unclassifiable → "note".
- NEVER use "task".

OTHER RULES
- Times are LOCAL wall-clock exactly as printed ("8:05 AM" → "T08:05"). NEVER timezone-convert. Use null when no time is stated and no default applies.
- One item per booked thing: the same PNR appearing across an original + reminder + receipt yields ONE item, taken from the most complete email. An email covering multiple things yields multiple items.
- costUsd only when the currency is explicitly USD ("$" or "USD"); otherwise null, and put the amount (e.g. "CHF 1,240") in notes (keep notes ≤ 200 chars).
- When one booking's total price covers multiple items (e.g. a round-trip fare across two flight segments), put costUsd on the FIRST item only; the others get null so the trip total isn't double-counted.
- If nothing qualifies, return { "items": [] }.`;
}

export function serializeEmailsForPrompt(emails: GmailEmail[]): string {
  return emails
    .map(
      (em, i) =>
        `=== EMAIL ${i + 1} ===\nFrom: ${em.from}\nDate: ${em.date}\nSubject: ${em.subject}\n\n${em.text}`
    )
    .join("\n\n");
}

const NAIVE_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function trimOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

export function validateProposals(
  raw: unknown,
  emails: GmailEmail[]
): Omit<ScanProposal, "duplicate">[] {
  const items = (raw as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const out: Omit<ScanProposal, "duplicate">[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;

    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (!title) continue;

    const kind = typeof e.kind === "string" ? e.kind : "";
    if (!(SCAN_KINDS as readonly string[]).includes(kind)) continue;

    const startAt =
      typeof e.startAt === "string" && NAIVE_DT_RE.test(e.startAt) ? e.startAt : null;
    const endAt =
      typeof e.endAt === "string" && NAIVE_DT_RE.test(e.endAt) ? e.endAt : null;

    const costUsd =
      typeof e.costUsd === "number" && Number.isFinite(e.costUsd) && e.costUsd >= 0
        ? e.costUsd
        : null;

    const url =
      typeof e.url === "string" && e.url.trim().startsWith("http") ? e.url.trim() : null;

    const idxRaw = e.emailIndex;
    const idx =
      typeof idxRaw === "number" &&
      Number.isInteger(idxRaw) &&
      idxRaw >= 1 &&
      idxRaw <= emails.length
        ? idxRaw
        : 1;
    const source = emails[idx - 1];

    out.push({
      kind,
      title,
      startAt,
      endAt,
      location: trimOrNull(e.location),
      fromLocation: trimOrNull(e.fromLocation),
      toLocation: trimOrNull(e.toLocation),
      confirmation: trimOrNull(e.confirmation),
      url,
      costUsd,
      notes: trimOrNull(e.notes),
      sourceSubject: source.subject,
      sourceDate: source.date,
    });

    if (out.length >= 60) break;
  }
  return out;
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normConf = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Parse a proposal's naive wall-clock string as UTC purely for interval math.
function naiveToMs(s: string | null): number | null {
  if (!s) return null;
  const ms = Date.parse(s + "Z");
  return Number.isNaN(ms) ? null : ms;
}

type MatchTarget = {
  kind: string;
  normTitle: string;
  normConf: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  startMs: number | null;
  checkIn: string | null; // YYYY-MM-DD
  checkOut: string | null; // YYYY-MM-DD
};

function existingToTarget(it: ExistingItemLite): MatchTarget {
  return {
    kind: it.kind,
    normTitle: normTitle(it.title),
    normConf: it.confirmation ? normConf(it.confirmation) : null,
    fromLocation: it.fromLocation,
    toLocation: it.toLocation,
    startMs: it.startAt ? it.startAt.getTime() : null,
    checkIn: it.startAt ? it.startAt.toISOString().slice(0, 10) : null,
    checkOut: it.endAt ? it.endAt.toISOString().slice(0, 10) : null,
  };
}

function proposalToTarget(p: Omit<ScanProposal, "duplicate">): MatchTarget {
  return {
    kind: p.kind,
    normTitle: normTitle(p.title),
    normConf: p.confirmation ? normConf(p.confirmation) : null,
    fromLocation: p.fromLocation,
    toLocation: p.toLocation,
    startMs: naiveToMs(p.startAt),
    checkIn: p.startAt ? p.startAt.slice(0, 10) : null,
    checkOut: p.endAt ? p.endAt.slice(0, 10) : null,
  };
}

function matches(a: MatchTarget, b: MatchTarget): boolean {
  // 1. Confirmation code, both present and ≥ 5 normalized chars.
  if (a.normConf && b.normConf && a.normConf.length >= 5 && a.normConf === b.normConf) {
    return true;
  }
  // 2. Same kind + identical normalized title.
  if (a.kind === b.kind && a.normTitle && a.normTitle === b.normTitle) {
    return true;
  }
  // 3. Flight/transport route + time within 24h.
  if (
    a.kind === b.kind &&
    (a.kind === "flight" || a.kind === "transport") &&
    a.fromLocation &&
    a.toLocation &&
    b.fromLocation &&
    b.toLocation &&
    a.fromLocation.trim().toLowerCase() === b.fromLocation.trim().toLowerCase() &&
    a.toLocation.trim().toLowerCase() === b.toLocation.trim().toLowerCase() &&
    a.startMs != null &&
    b.startMs != null &&
    Math.abs(a.startMs - b.startMs) <= DAY_MS
  ) {
    return true;
  }
  // 4. Lodging with overlapping date ranges.
  if (
    a.kind === "lodging" &&
    b.kind === "lodging" &&
    a.checkIn &&
    a.checkOut &&
    b.checkIn &&
    b.checkOut &&
    a.checkIn < b.checkOut &&
    b.checkIn < a.checkOut
  ) {
    return true;
  }
  return false;
}

export function markDuplicates(
  proposals: Omit<ScanProposal, "duplicate">[],
  existing: ExistingItemLite[]
): ScanProposal[] {
  const existingTargets = existing.map(existingToTarget);
  const accepted: { proposal: ScanProposal; target: MatchTarget }[] = [];

  for (const p of proposals) {
    const target = proposalToTarget(p);

    // Drop exact intra-scan clones outright (same conf AND same title).
    const clone = accepted.some(
      (a) =>
        a.target.normConf &&
        target.normConf &&
        a.target.normConf === target.normConf &&
        a.target.normTitle === target.normTitle
    );
    if (clone) continue;

    const dupAgainstExisting = existingTargets.some((t) => matches(target, t));
    const dupAgainstEarlier = accepted.some(
      (a) => !a.proposal.duplicate && matches(target, a.target)
    );
    const duplicate = dupAgainstExisting || dupAgainstEarlier;

    const proposal: ScanProposal = { ...p, duplicate };
    accepted.push({ proposal, target });
  }

  return accepted.map((a) => a.proposal);
}
