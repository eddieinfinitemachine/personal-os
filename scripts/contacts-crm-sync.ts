/**
 * Contacts → CRM auto-add: every few minutes, posts macOS Contacts cards
 * created since the last run to /api/capture/people, which adds new people to
 * the CRM (deduped server-side). New cards only: the first run just records
 * "now" unless --since is given. Then every card's birthday is offered to
 * /api/capture/people/birthdays, which fills it in on the matching existing
 * person (by card id, phone or email) and never overwrites one already set;
 * that pass runs when the birthdays change and at least daily.
 * CLI execution only; imports are side-effect free.
 *
 *   tsx scripts/contacts-crm-sync.ts [--dry-run] [--verbose] [--since <ISO|YYYY-MM-DD>]
 *
 * Logs aggregate lines; --verbose adds "<cardId> <result>" per new card. Never names.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseBirthday } from "../src/lib/birthday";

export const BATCH_SIZE = 50;
/** The server's per-request cap (PEOPLE_CAPTURE_LIMITS.maxPeople). */
export const BIRTHDAY_BATCH_SIZE = 200;
/** Unchanged birthdays are still re-sent this often, so people added to the CRM since get theirs. */
export const BIRTHDAY_RESEND_MS = 86_400_000;
/** iPhone-created cards reach this Mac via iCloud after later local ones; re-scan this far behind `since`. */
export const LOOKBACK_MS = 3 * 86_400_000;
/**
 * More new cards than this in one run is an import or iCloud re-sync (Contacts
 * restamps creationDate), not people Eddie just added: skip them and move the
 * floor past them. An explicit --since re-scans and bypasses this.
 */
export const BULK_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 60_000;

export type ContactCard = {
  id: string;
  firstName: string;
  lastName: string;
  organization: string;
  /** Mobile numbers first. */
  phones: string[];
  emails: string[];
  creationDate: string;
  modificationDate: string | null;
  /** YYYY-MM-DD as Contacts shows it; year 1604 when saved without a year. */
  birthday: string | null;
};
/**
 * `floor` is the install moment (or --since) and never moves, so the lookback
 * never reaches cards that predate installation. `posted` maps handled card
 * ids to their creationDate and is pruned once they fall behind the window.
 */
export type Checkpoint = { version: 1; since: string; floor?: string; posted: Record<string, string> };
export type Flags = { dryRun: boolean; verbose: boolean; since: string | null };
export type PostResult = { created: { cardId: string; personId: string }[]; skipped: { cardId: string; reason: string }[] };
export type Summary = { cards: number; selected: number; created: number; skipped: number; wouldPost: number; firstRun: boolean; bulk: boolean };

export function parseSince(raw: string | undefined): string {
  const s = raw?.trim() ?? "";
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(s);
  if (!s || Number.isNaN(date.getTime())) throw new Error("--since needs an ISO date or YYYY-MM-DD");
  return date.toISOString();
}

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { dryRun: false, verbose: false, since: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--verbose") flags.verbose = true;
    else if (arg === "--since") flags.since = parseSince(argv[++i]);
    else if (arg.startsWith("--since=")) flags.since = parseSince(arg.slice(8));
    else throw new Error(`Unknown option ${arg}`);
  }
  return flags;
}

export function readCheckpoint(value: unknown): Checkpoint | null {
  const c = value as Checkpoint | null;
  if (!c || c.version !== 1 || typeof c.since !== "string" || Number.isNaN(Date.parse(c.since))) return null;
  if (!c.posted || typeof c.posted !== "object" || Array.isArray(c.posted)) return null;
  if (c.floor !== undefined && (typeof c.floor !== "string" || Number.isNaN(Date.parse(c.floor)))) return null;
  return c;
}

const time = (iso: string) => Date.parse(iso);

/** Cards created after the scan window's start that were never handled, oldest first. */
export function selectNewCards(cards: ContactCard[], checkpoint: Checkpoint, since: string = checkpoint.since): ContactCard[] {
  const floor = checkpoint.floor ? time(checkpoint.floor) : -Infinity;
  const start = Math.max(floor, time(since) - LOOKBACK_MS);
  return cards
    .filter((c) => time(c.creationDate) > start && !(c.id in checkpoint.posted))
    .sort((a, b) => time(a.creationDate) - time(b.creationDate) || a.id.localeCompare(b.id));
}

export async function syncContactsToCrm(options: {
  exportCards: () => Promise<ContactCard[]>;
  post: (people: object[]) => Promise<PostResult>;
  checkpoint: Checkpoint | null;
  save: (checkpoint: Checkpoint) => Promise<void>;
  flags: Flags;
  now?: Date;
  log?: (line: string) => void;
}): Promise<Summary> {
  const { flags } = options;
  const log = options.log ?? console.log;
  const now = (options.now ?? new Date()).toISOString();
  const summary: Summary = { cards: 0, selected: 0, created: 0, skipped: 0, wouldPost: 0, firstRun: false, bulk: false };

  let checkpoint = options.checkpoint;
  if (!checkpoint && !flags.since) {
    // First run: start watching from now; never backfill the existing address book.
    summary.firstRun = true;
    if (!flags.dryRun) await options.save({ version: 1, since: now, floor: now, posted: {} });
    return summary;
  }
  if (!checkpoint) checkpoint = { version: 1, since: flags.since!, floor: flags.since!, posted: {} };
  const since = flags.since ?? checkpoint.since;
  // An explicit --since earlier than the floor widens the window on purpose.
  const floor = flags.since && (!checkpoint.floor || time(flags.since) < time(checkpoint.floor)) ? flags.since : checkpoint.floor;
  const window: Checkpoint = { ...checkpoint, floor };

  const cards = await options.exportCards();
  summary.cards = cards.length;
  const selected = selectNewCards(cards, window, since);
  summary.selected = selected.length;
  if (selected.length > BULK_LIMIT && !flags.since) {
    summary.bulk = true;
    if (!flags.dryRun) {
      const newest = new Date(Math.max(time(checkpoint.since), ...selected.map((c) => time(c.creationDate)))).toISOString();
      await options.save({ version: 1, since: newest, floor: newest, posted: checkpoint.posted });
    }
    return summary;
  }
  if (flags.dryRun) {
    summary.wouldPost = selected.length;
    if (flags.verbose) for (const c of selected) log(`${c.id} would-post`);
    return summary;
  }

  const posted = { ...checkpoint.posted };
  let newest = time(checkpoint.since);
  for (let i = 0; i < selected.length; i += BATCH_SIZE) {
    const batch = selected.slice(i, i + BATCH_SIZE);
    // Throws on failure: nothing is saved, so the whole run retries next time (the server is idempotent).
    const result = await options.post(batch.map((c) => ({
      cardId: c.id,
      firstName: c.firstName,
      lastName: c.lastName || null,
      company: c.organization || null,
      phones: c.phones,
      emails: c.emails,
      createdAt: c.creationDate,
      birthday: c.birthday,
    })));
    summary.created += result.created.length;
    summary.skipped += result.skipped.length;
    if (flags.verbose) {
      for (const r of result.created) log(`${r.cardId} created`);
      for (const r of result.skipped) log(`${r.cardId} skipped:${r.reason}`);
    }
    for (const c of batch) {
      posted[c.id] = c.creationDate;
      newest = Math.max(newest, time(c.creationDate));
    }
  }
  const nextSince = new Date(newest).toISOString();
  const windowStart = time(nextSince) - LOOKBACK_MS;
  for (const [id, created] of Object.entries(posted)) if (time(created) <= windowStart) delete posted[id];
  await options.save({ version: 1, since: nextSince, ...(floor ? { floor } : {}), posted });
  return summary;
}

export function summaryLine(s: Summary, dryRun: boolean): string {
  if (s.bulk) return `Contacts CRM sync${dryRun ? " (dry run)" : ""}: ${s.cards} cards, ${s.selected} new looks like an import or re-sync (over ${BULK_LIMIT}); none added. Re-run with --since to add them`;
  if (s.firstRun) return `Contacts CRM sync: first run${dryRun ? " (dry run)" : ""}, watching for cards created from now on`;
  return dryRun
    ? `Contacts CRM sync (dry run): ${s.cards} cards, ${s.wouldPost} would post`
    : `Contacts CRM sync: ${s.cards} cards, ${s.selected} new, ${s.created} created, ${s.skipped} skipped`;
}

export type BirthdayState = { version: 1; digest: string; sentAt: string };
export type BirthdayCounts = { filled: number; alreadySet: number; unmatched: number; ambiguous: number; conflicting: number };
export type BirthdaySummary = BirthdayCounts & { cards: number; sent: number; wouldSend: number; unchanged: boolean };

export function readBirthdayState(value: unknown): BirthdayState | null {
  const s = value as BirthdayState | null;
  return s && s.version === 1 && typeof s.digest === "string" && typeof s.sentAt === "string" && !Number.isNaN(Date.parse(s.sentAt)) ? s : null;
}

/** Cards with a birthday and a phone or email to match on, in a stable order. */
export function birthdayCards(cards: ContactCard[]) {
  return cards
    .flatMap((c) => (c.birthday && (c.phones.length || c.emails.length) ? [{ cardId: c.id, phones: c.phones, emails: c.emails, birthday: c.birthday }] : []))
    .sort((a, b) => a.cardId.localeCompare(b.cardId));
}

/** Offers every card birthday to the server's fill-only endpoint when they changed or a day has passed. */
export async function syncContactBirthdays(options: {
  exportCards: () => Promise<ContactCard[]>;
  post: (birthdays: object[]) => Promise<Partial<BirthdayCounts>>;
  state: BirthdayState | null;
  save: (state: BirthdayState) => Promise<void>;
  flags: Flags;
  now?: Date;
}): Promise<BirthdaySummary> {
  const now = options.now ?? new Date();
  const cards = birthdayCards(await options.exportCards());
  const digest = createHash("sha256").update(JSON.stringify(cards)).digest("hex");
  const summary: BirthdaySummary = { cards: cards.length, sent: 0, wouldSend: 0, unchanged: false, filled: 0, alreadySet: 0, unmatched: 0, ambiguous: 0, conflicting: 0 };
  const { state } = options;
  if (state?.digest === digest && now.getTime() - Date.parse(state.sentAt) < BIRTHDAY_RESEND_MS) {
    summary.unchanged = true;
    return summary;
  }
  if (options.flags.dryRun) {
    summary.wouldSend = cards.length;
    return summary;
  }
  for (let i = 0; i < cards.length; i += BIRTHDAY_BATCH_SIZE) {
    const batch = cards.slice(i, i + BIRTHDAY_BATCH_SIZE);
    // Throws on failure: nothing is saved, so the next run sends again (the server only fills blanks).
    const result = await options.post(batch);
    summary.sent += batch.length;
    for (const key of ["filled", "alreadySet", "unmatched", "ambiguous", "conflicting"] as const) summary[key] += Number(result[key]) || 0;
  }
  await options.save({ version: 1, digest, sentAt: now.toISOString() });
  return summary;
}

export function birthdaySummaryLine(s: BirthdaySummary, dryRun: boolean): string {
  if (s.unchanged) return `Contacts birthdays: ${s.cards} cards, unchanged since the last send`;
  if (dryRun) return `Contacts birthdays (dry run): ${s.wouldSend} cards would be sent`;
  return `Contacts birthdays: ${s.sent} sent, ${s.filled} filled, ${s.alreadySet} already set, ${s.unmatched} unmatched, ${s.ambiguous} ambiguous, ${s.conflicting} conflicting`;
}

const MOBILE = /mobile|iphone|cell/i;
// AppleScript dates are wall-clock dates, so the local calendar fields are the
// birthday Contacts shows (Contacts uses year 1604 when no year was given).
// Birthdays are optional: if they cannot be read, cards still sync without them.
export const CONTACTS_JXA = `
const people = Application("Contacts").people;
const ids=people.id(), firsts=people.firstName(), lasts=people.lastName(), orgs=people.organization();
const phones=people.phones.value(), labels=people.phones.label(), emails=people.emails.value();
const created=people.creationDate(), modified=people.modificationDate();
let births=[]; try { births=people.birthDate(); } catch (e) {}
const iso=(d)=>d instanceof Date && !isNaN(d) ? d.toISOString() : null;
const pad=(n,w)=>String(n).padStart(w,"0");
const ymd=(d)=>d instanceof Date && !isNaN(d) ? pad(d.getFullYear(),4)+"-"+pad(d.getMonth()+1,2)+"-"+pad(d.getDate(),2) : null;
JSON.stringify(ids.map((id,i)=>({id,firstName:firsts[i]||"",lastName:lasts[i]||"",organization:orgs[i]||"",phones:phones[i]||[],phoneLabels:labels[i]||[],emails:emails[i]||[],creationDate:iso(created[i]),modificationDate:iso(modified[i]),birthday:ymd(births[i])})));`;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Shapes raw JXA rows; drops rows without an id or creation date (they cannot be tracked). */
export function toContactCards(raw: unknown): ContactCard[] {
  if (!Array.isArray(raw)) throw new Error("Invalid Contacts export");
  return raw.flatMap((row) => {
    const r = row as Record<string, unknown>;
    if (!r || typeof r.id !== "string" || !r.id || typeof r.creationDate !== "string" || Number.isNaN(Date.parse(r.creationDate))) return [];
    const labels = strings(r.phoneLabels);
    const phones = strings(r.phones)
      .map((value, i) => ({ value, mobile: MOBILE.test(labels[i] ?? "") }))
      .sort((a, b) => Number(b.mobile) - Number(a.mobile))
      .map((p) => p.value);
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    return [{
      id: r.id,
      firstName: text(r.firstName),
      lastName: text(r.lastName),
      organization: text(r.organization),
      phones,
      emails: strings(r.emails),
      creationDate: r.creationDate,
      modificationDate: typeof r.modificationDate === "string" ? r.modificationDate : null,
      birthday: parseBirthday(r.birthday) ? (r.birthday as string) : null,
    }];
  });
}

/** Read-only export of every person card via JXA (needs Automation access to Contacts). */
export async function exportContactCards(): Promise<ContactCard[]> {
  const { stdout } = await promisify(execFile)("/usr/bin/osascript", ["-l", "JavaScript", "-e", CONTACTS_JXA], {
    timeout: 120_000, maxBuffer: 40 * 1024 * 1024, encoding: "utf8",
  });
  return toContactCards(JSON.parse(stdout));
}

export async function runContactsCrmWorker(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  try { process.loadEnvFile(".env"); } catch {}
  const base = new URL(process.env.CRM_CONTEXT_SYNC_URL ?? process.env.CALL_SHEET_SYNC_URL ?? process.env.DATING_SYNC_URL ?? process.env.APP_URL ?? "");
  const token = process.env.CAPTURE_TOKEN;
  if (base.protocol !== "https:" || base.username || base.password || !token) throw new Error("Contacts CRM connection is not configured");
  const dataDir = join(homedir(), "Library/Application Support/personal-os");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const key = createHash("sha256").update(JSON.stringify([base.origin, token])).digest("hex");
  const file = join(dataDir, `contacts-crm-sync-${key}.json`);
  const birthdayFile = join(dataDir, `contacts-birthdays-${key}.json`);
  const read = async <T>(path: string, parse: (value: unknown) => T | null) => {
    try { return parse(JSON.parse(await readFile(path, "utf8"))); } catch { return null; }
  };
  const write = async (path: string, data: object) => {
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
    await rename(temp, path);
  };
  const post = async <T>(path: string, body: object): Promise<T> => {
    const response = await fetch(new URL(path, base), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Status code only (never response bodies).
    if (!response.ok) throw new Error(`Contacts CRM request failed (${response.status})`);
    return response.json() as Promise<T>;
  };
  // Both passes read the same (slow) Contacts export.
  let exported: Promise<ContactCard[]> | null = null;
  const exportCards = () => (exported ??= exportContactCards());

  const summary = await syncContactsToCrm({
    exportCards,
    post: (people) => post<PostResult>("/api/capture/people", { people }),
    checkpoint: await read(file, readCheckpoint), flags,
    save: (data) => write(file, data),
  });
  console.log(summaryLine(summary, flags.dryRun));
  const birthdays = await syncContactBirthdays({
    exportCards,
    post: (cards) => post<Partial<BirthdayCounts>>("/api/capture/people/birthdays", { birthdays: cards }),
    state: await read(birthdayFile, readBirthdayState), flags,
    save: (data) => write(birthdayFile, data),
  });
  console.log(birthdaySummaryLine(birthdays, flags.dryRun));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runContactsCrmWorker(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(`Contacts CRM sync could not finish (${e instanceof Error ? e.message : "unknown error"}). Check the connection, flags and Contacts access.`); process.exitCode = 1; });
}
