// Pure helpers for the Mac message sync (scripts/dating-messages-sync.ts) and
// its capture endpoint. No Node or DB imports: the route bundles this file.

/** Sources the Mac sync may send to /api/capture/dating. */
export const CAPTURE_SOURCES = ["imessage", "whatsapp"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

/** The source if it's on the allowlist, `fallback` when absent, null when invalid. */
export function captureSource(value: unknown, fallback: CaptureSource): CaptureSource | null {
  if (value === undefined || value === null) return fallback;
  return (CAPTURE_SOURCES as readonly unknown[]).includes(value) ? (value as CaptureSource) : null;
}

export const SOURCE_LABELS: Record<string, string> = { imessage: "iMessage", whatsapp: "WhatsApp", paste: "Pasted" };

// Both iMessage and WhatsApp (Core Data) count from 2001-01-01 UTC.
export const APPLE_EPOCH_MS = 978307200000;

/** iMessage message.date: seconds before High Sierra, nanoseconds after. */
export function appleDate(date: number): Date {
  return date < 1e12 ? new Date(APPLE_EPOCH_MS + date * 1000) : new Date(APPLE_EPOCH_MS + date / 1e6);
}

export function toAppleNs(iso: string): number {
  return (new Date(iso).getTime() - APPLE_EPOCH_MS) * 1e6;
}

/** Core Data timestamp (seconds since 2001, may be fractional) → Date. */
export function coreDataDate(seconds: number): Date {
  return new Date(APPLE_EPOCH_MS + seconds * 1000);
}

export function toCoreDataSeconds(iso: string): number {
  return (new Date(iso).getTime() - APPLE_EPOCH_MS) / 1000;
}

const WA_USER_SUFFIX = "@s.whatsapp.net";

/**
 * The E.164 phone ("+15551234567") of a 1:1 WhatsApp JID, else null.
 * Groups (@g.us), status/broadcast lists (@broadcast), newsletters and
 * privacy ids (@lid, which carry no phone number) all return null.
 * WhatsApp JIDs always include the country code, so no +1 guessing here.
 */
export function whatsappJidPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const s = jid.trim().toLowerCase();
  if (!s.endsWith(WA_USER_SUFFIX)) return null;
  // Device-scoped JIDs look like "15551234567:12@s.whatsapp.net".
  const user = s.slice(0, -WA_USER_SUFFIX.length).split(":")[0];
  if (!/^\d{7,15}$/.test(user)) return null;
  return `+${user}`;
}

export type WhatsAppSession = { pk: number; jid: string | null; type: number | null };

export type WhatsAppIdentityRow = { phone: unknown; jid: unknown; lid: unknown };

function whatsappLid(value: unknown, bare = false): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().toLowerCase().match(bare ? /^(\d{1,20})(?::\d+)?(?:@lid)?$/ : /^(\d{1,20})(?::\d+)?@lid$/);
  return match ? `${match[1]}@lid` : null;
}

// ContactsV2 phone/WhatsApp-ID columns already contain international numbers.
// Do not guess +1, or interpret values from any other JID namespace as phones.
function contactPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  const jid = raw.match(/^([1-9]\d{6,14})(?::\d+)?@s\.whatsapp\.net$/);
  if (jid) return `+${jid[1]}`;
  if (!/^\+?[\d ().-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}

/** Only one-to-one, nonconflicting ContactsV2 identity evidence is usable. */
export function buildWhatsAppIdentityMap(rows: WhatsAppIdentityRow[]): Map<string, string> {
  const phonesByLid = new Map<string, Set<string>>();
  const lidsByPhone = new Map<string, Set<string>>();
  const invalidLids = new Set<string>();
  for (const row of rows) {
    const lid = whatsappLid(row.lid, true);
    if (!lid) continue;
    const values = [row.phone, row.jid].filter((v) => v !== null && v !== undefined && v !== "");
    const phones = values.map(contactPhone);
    if (!phones.length || phones.some((phone) => !phone)) invalidLids.add(lid);
    // Keep every valid edge even in a conflicting row: discarding it first
    // could make another row appear falsely unambiguous.
    for (const phone of phones) {
      if (!phone) continue;
      if (!phonesByLid.has(lid)) phonesByLid.set(lid, new Set());
      phonesByLid.get(lid)!.add(phone);
      if (!lidsByPhone.has(phone)) lidsByPhone.set(phone, new Set());
      lidsByPhone.get(phone)!.add(lid);
    }
  }
  const result = new Map<string, string>();
  for (const [lid, phones] of phonesByLid) {
    if (invalidLids.has(lid) || phones.size !== 1) continue;
    const phone = [...phones][0];
    if (lidsByPhone.get(phone)?.size === 1) result.set(lid, phone);
  }
  return result;
}

/** Session primary keys whose 1:1 JID matches one of `handles` (normalized). */
export function matchWhatsAppSessions(sessions: WhatsAppSession[], handles: string[], identityMap?: ReadonlyMap<string, string>): number[] {
  const want = new Set(handles);
  return sessions
    .filter((s) => {
      if (s.type !== 0 && s.type !== null) return false;
      const direct = whatsappJidPhone(s.jid);
      const lid = whatsappLid(s.jid);
      const mapped = lid ? identityMap?.get(lid) : undefined;
      const phone = direct ?? (mapped && /^\+[1-9]\d{6,14}$/.test(mapped) ? mapped : null);
      return phone !== null && want.has(phone);
    })
    .map((s) => s.pk);
}

export type SyncedMessage = { guid: string; sentAt: string; fromMe: boolean; text: string; source: CaptureSource };

export type WhatsAppRow = {
  stanza: string | null;
  date: number | null;
  from_me: number | null;
  text: string | null;
  type: number | null;
};

/** A WhatsApp row → message, or null for non-text, empty or id-less rows. */
export function mapWhatsAppRow(r: WhatsAppRow): SyncedMessage | null {
  if (r.type !== 0 || !r.stanza || typeof r.date !== "number") return null;
  const text = r.text?.trim();
  if (!text) return null;
  return { guid: `wa:${r.stanza}`, sentAt: coreDataDate(r.date).toISOString(), fromMe: r.from_me === 1, text, source: "whatsapp" };
}

export type IMessageRow = { guid: string; date: number; from_me: number; text: string | null; decoded: string | null };

/** An iMessage row (with its attributedBody already decoded) → message, or null. */
export function mapIMessageRow(r: IMessageRow): SyncedMessage | null {
  const text = r.text?.replace(/￼/g, "").trim() || r.decoded?.trim() || null;
  if (!text) return null;
  return { guid: r.guid, sentAt: appleDate(r.date).toISOString(), fromMe: r.from_me === 1, text, source: "imessage" };
}

/** "Ana: 12 iMessage, 3 WhatsApp messages (4 new)". */
export function summaryLine(name: string, imessage: number, whatsapp: number, added: number | null): string {
  return `${name}: ${imessage} iMessage, ${whatsapp} WhatsApp messages (${added === null ? "dry run" : `${added} new`})`;
}
