/**
 * Hourly CRM context backfill: reads each CRM person's 1:1 iMessage/WhatsApp
 * threads on this Mac and posts a bounded copy so the server can write
 * Person.context. CLI execution only; imports are side-effect free.
 *
 *   tsx scripts/crm-context-sync.ts [--dry-run] [--limit N] [--person "Full Name"] [--force] [--include-empty] [--verbose]
 *
 * Logs one aggregate line plus failed person ids; --verbose adds one
 * "<personId> <status>" line per posted person. Never names or message text.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_DB, WHATSAPP_DB, WHATSAPP_CONTACTS_DB, snapshotDb, iMessageHandleIndex,
  readIMessages, whatsAppSessions, readWhatsAppIdentityMap, readWhatsAppMessages, whatsAppSchemaProblems,
} from "../src/lib/dating-message-readers";
import { toAppleNs, toCoreDataSeconds, type SyncedMessage } from "../src/lib/dating-message-sync";
import type { DatingContact } from "../src/lib/dating-contact-match";
import type { ContextTargets } from "../src/lib/person-context/capture";
import type { RefreshResult } from "../src/lib/person-context/generate";
import { CONTEXT_LIMITS, type ContextThread } from "../src/lib/person-context/types";
import { resolveCallSheetTargets } from "./call-sheet-sync";
import { readFreshDatingContacts } from "./dating-contact-cache";

const DAY = 86_400_000;
const POST_GAP_MS = 500;
const BUSY_RETRIES = 2;
const BUSY_WAIT_MS = 5000;
const REQUEST_TIMEOUT_MS = 120_000;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export type ContextTarget = ContextTargets["people"][number] & { handles: string[] };
export type Checkpoint = { version: 1; digests: Record<string, string> };
export type Flags = { dryRun: boolean; limit: number | null; person: string | null; force: boolean; includeEmpty: boolean; verbose: boolean };
export type Reader = { messages: (target: ContextTarget) => SyncedMessage[] };
export type API = {
  targets: () => Promise<ContextTargets>;
  post: (body: { personId: string; threads: ContextThread[]; force?: boolean }) => Promise<RefreshResult>;
};
export type Summary = {
  targets: number; posted: number; updated: number; unchanged: number; skipped: number; failed: number;
  wouldPost: number; failedIds: string[];
};

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { dryRun: false, limit: null, person: null, force: false, includeEmpty: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--force") flags.force = true;
    else if (arg === "--include-empty") flags.includeEmpty = true;
    else if (arg === "--verbose") flags.verbose = true;
    else if (arg === "--limit" || arg.startsWith("--limit=")) {
      const raw = arg.includes("=") ? arg.slice(8) : argv[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) throw new Error("--limit needs a whole number");
      flags.limit = n;
    } else if (arg === "--person" || arg.startsWith("--person=")) {
      const raw = arg.includes("=") ? arg.slice(9) : argv[++i];
      if (!raw?.trim()) throw new Error("--person needs a full name");
      flags.person = raw.trim().replace(/\s+/g, " ");
    } else throw new Error(`Unknown option ${arg}`);
  }
  return flags;
}

/**
 * Newest messages within the window that fit every CONTEXT_LIMITS cap, then
 * one thread per source in chronological order. Matches the server's checks.
 */
export function boundContextThreads(messages: SyncedMessage[], now: Date): ContextThread[] {
  const since = now.getTime() - CONTEXT_LIMITS.threadDays * DAY;
  const seen = new Set<string>();
  const kept: (SyncedMessage & { at: number })[] = [];
  let chars = 0;
  const newest = messages
    .map((m) => ({ ...m, at: Date.parse(m.sentAt) }))
    .filter((m) => Number.isFinite(m.at) && m.at >= since && m.at <= now.getTime() && m.text.trim())
    .sort((a, b) => b.at - a.at || b.guid.localeCompare(a.guid));
  for (const m of newest) {
    const key = m.source + ":" + m.guid;
    if (seen.has(key) || !m.guid || m.guid.length > 200) continue;
    if (kept.length >= CONTEXT_LIMITS.maxMessagesPerPerson) break;
    const text = m.text.slice(0, CONTEXT_LIMITS.maxCharsPerMessage);
    if (chars + text.length > CONTEXT_LIMITS.maxThreadChars) break;
    seen.add(key);
    chars += text.length;
    kept.push({ ...m, text });
  }
  kept.reverse();
  return (["imessage", "whatsapp"] as const).flatMap((source) => {
    const list = kept.filter((m) => m.source === source);
    return list.length
      ? [{ source, messages: list.map((m) => ({ id: m.guid, sentAt: new Date(m.at).toISOString(), fromMe: m.fromMe, text: m.text })) }]
      : [];
  });
}

export function threadDigest(threads: ContextThread[]): string {
  return hash(threads.map((t) => [t.source, t.messages.map((m) => [m.id, m.text])]));
}

const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.toLowerCase();

export async function syncCrmContext(options: {
  api: API;
  contacts: () => Promise<DatingContact[]>;
  open: (now: Date) => Promise<Reader>;
  checkpoint: Checkpoint;
  save: (checkpoint: Checkpoint) => Promise<void>;
  flags: Flags;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}): Promise<Summary> {
  const now = options.now ?? new Date();
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { flags, checkpoint } = options;
  const config = await options.api.targets();
  let targets: ContextTarget[] = resolveCallSheetTargets(config, await options.contacts());
  if (flags.person) targets = targets.filter((t) => sameName(t.name, flags.person!));
  else {
    const present = new Set(targets.map((t) => t.id));
    for (const id of Object.keys(checkpoint.digests)) if (!present.has(id)) delete checkpoint.digests[id];
  }
  const summary: Summary = { targets: targets.length, posted: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, wouldPost: 0, failedIds: [] };
  const fail = (id: string) => { summary.failed++; summary.failedIds.push(id); };
  const log = options.log ?? console.log;
  const report = (id: string, status: string) => { if (flags.verbose) log(`${id} ${status}`); };
  const reader = targets.some((t) => t.handles.length) ? await options.open(now) : null;
  let requests = 0;

  for (const target of targets) {
    let threads: ContextThread[];
    try {
      threads = reader && target.handles.length ? boundContextThreads(reader.messages(target), now) : [];
    } catch { fail(target.id); continue; }
    if (!threads.length && !flags.includeEmpty) { summary.skipped++; continue; }
    const digest = threadDigest(threads);
    if (!flags.force && target.contextAt && checkpoint.digests[target.id] === digest) { summary.unchanged++; continue; }
    if (flags.limit !== null && summary.posted + summary.wouldPost >= flags.limit) break;
    if (flags.dryRun) { summary.wouldPost++; continue; }
    summary.posted++;
    try {
      let result: RefreshResult | null = null;
      for (let attempt = 0; attempt <= BUSY_RETRIES; attempt++) {
        if (requests++) await sleep(attempt ? BUSY_WAIT_MS : POST_GAP_MS);
        result = await options.api.post({ personId: target.id, threads, ...(flags.force ? { force: true } : {}) });
        if (result.status !== "busy") break;
      }
      report(target.id, result?.status ?? "busy");
      if (!result || result.status === "busy") { summary.skipped++; continue; }
      if (result.status === "updated") summary.updated++;
      else if (result.status === "unchanged") summary.unchanged++;
      else summary.skipped++;
      checkpoint.digests[target.id] = digest;
      await options.save(checkpoint);
    } catch (e) {
      fail(target.id); report(target.id, "failed");
      // Status code only (never response bodies), so a broken deploy is diagnosable from the log.
      if (flags.verbose) console.error(`  ${e instanceof Error ? e.message : "request failed"}`);
    }
  }
  if (!flags.dryRun) await options.save(checkpoint);
  return summary;
}

/** Snapshot both message databases once. A missing source is skipped; both missing is an error. */
export function openContextSources(root: string, now: Date): Reader {
  const since = new Date(now.getTime() - CONTEXT_LIMITS.threadDays * DAY).toISOString();
  let imessage: { db: string; index: Map<string, number[]> } | null = null;
  let whatsapp: { db: string; sessions: ReturnType<typeof whatsAppSessions>; identity: Map<string, string> } | null = null;
  try {
    const temp = mkdtempSync(join(root, "imessage-"));
    const db = snapshotDb(CHAT_DB, temp);
    imessage = { db, index: iMessageHandleIndex(db) };
  } catch { /* unavailable: continue with WhatsApp */ }
  try {
    const temp = mkdtempSync(join(root, "whatsapp-"));
    const db = snapshotDb(WHATSAPP_DB, temp);
    if (whatsAppSchemaProblems(db).length) throw new Error("WhatsApp schema changed");
    let identity = new Map<string, string>();
    try { identity = readWhatsAppIdentityMap(snapshotDb(WHATSAPP_CONTACTS_DB, mkdtempSync(join(root, "whatsapp-ids-")))); } catch {}
    whatsapp = { db, sessions: whatsAppSessions(db), identity };
  } catch { /* unavailable: continue with iMessage */ }
  if (!imessage && !whatsapp) throw new Error("No message source is readable");
  return {
    messages(target) {
      return [
        ...(imessage ? readIMessages(imessage.db, target.handles.flatMap((h) => imessage!.index.get(h) ?? []), toAppleNs(since)) : []),
        ...(whatsapp ? readWhatsAppMessages(whatsapp.db, whatsapp.sessions, target.handles, toCoreDataSeconds(since), whatsapp.identity) : []),
      ];
    },
  };
}

export function summaryLine(s: Summary, dryRun: boolean): string {
  return dryRun
    ? `CRM context sync (dry run): ${s.targets} targets, ${s.wouldPost} would post, ${s.unchanged} unchanged, ${s.skipped} skipped, ${s.failed} failed`
    : `CRM context sync: ${s.targets} targets, ${s.posted} posted, ${s.updated} updated, ${s.unchanged} unchanged, ${s.skipped} skipped, ${s.failed} failed`;
}

export async function runCrmContextWorker(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  try { process.loadEnvFile(".env"); } catch {}
  const base = new URL(process.env.CRM_CONTEXT_SYNC_URL ?? process.env.CALL_SHEET_SYNC_URL ?? process.env.DATING_SYNC_URL ?? process.env.APP_URL ?? "");
  const token = process.env.CAPTURE_TOKEN;
  if (base.protocol !== "https:" || base.username || base.password || !token) throw new Error("CRM context connection is not configured");
  const endpoint = new URL("/api/capture/people/context", base);
  const request = async (body?: object) => {
    const response = await fetch(endpoint, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`CRM context request failed (${response.status})`);
    return response.json();
  };
  const dataDir = join(homedir(), "Library/Application Support/personal-os");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, `crm-context-sync-${hash([base.origin, token])}.json`);
  let checkpoint: Checkpoint = { version: 1, digests: {} };
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    if (value?.version === 1 && value.digests && typeof value.digests === "object" && !Array.isArray(value.digests)) checkpoint = value;
  } catch {}

  const root = mkdtempSync(join(tmpdir(), "crm-context-sync-"));
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  const onSignal = (signal: NodeJS.Signals) => { cleanup(); process.exit(signal === "SIGINT" ? 130 : 143); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const summary = await syncCrmContext({
      api: { targets: () => request(), post: (body) => request(body) },
      checkpoint, flags,
      contacts: async () => {
        const cache = await readFreshDatingContacts();
        return cache.status === "ready" ? cache.contacts : [];
      },
      open: async (now) => openContextSources(root, now),
      save: async (data) => {
        const temp = file + "." + process.pid + ".tmp";
        await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
        await rename(temp, file);
      },
    });
    for (const id of summary.failedIds) console.error(`CRM context sync failed for person ${id}`);
    console.log(summaryLine(summary, flags.dryRun));
    return summary.failed ? 1 : 0;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCrmContextWorker(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(`CRM context sync could not finish (${e instanceof Error ? e.message : "unknown error"}). Check the connection, flags and Mac access.`); process.exitCode = 1; });
}
