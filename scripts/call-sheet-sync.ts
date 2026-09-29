/** Hourly, owner-scoped CRM message evidence. CLI execution only; imports are side-effect free. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { sweepStaleTempRoots } from "./sync-temp";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_DB, WHATSAPP_DB, WHATSAPP_CONTACTS_DB, snapshotDb, sqlite,
  iMessageHandleIndex, whatsAppSessions, readWhatsAppIdentityMap,
  readIMessages, readWhatsAppMessages, whatsAppSchemaProblems,
} from "../src/lib/dating-message-readers";
import { coreDataDate, matchWhatsAppSessions, toAppleNs, toCoreDataSeconds } from "../src/lib/dating-message-sync";
import { normalizeHandle } from "../src/lib/call-sheet/policy";
import { matchDatingContact, type DatingContact } from "../src/lib/dating-contact-match";
import { readFreshDatingContacts } from "./dating-contact-cache";
import type { CaptureConfig, CaptureMessage, CapturePerson, CallSheetSource } from "../src/lib/call-sheet/types";

export type Target = CaptureConfig["people"][number] & { handles: string[] };
export type Activity = { lastContactAt: string | null; messageCount: number };
type SourceReader = {
  activity: (target: Target) => Activity;
  messages: (target: Target) => CaptureMessage[];
};
export type Checkpoint = { version: 1; metadata: Record<string, string>; cues: Record<string, string> };
type API = (body?: object) => Promise<any>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const SOURCES: CallSheetSource[] = ["imessage", "whatsapp"];
const DAY = 86400000;

/** Contacts only expand a unique complete name; every shared handle is removed. */
export function resolveCallSheetTargets<P extends { id: string; name: string; phone: string | null; email: string | null }>(
  config: { people: P[]; blockedHandles: string[] }, contacts: DatingContact[],
): (P & { handles: string[] })[] {
  const targets = config.people.map(p => {
    const match = matchDatingContact(p.name, contacts);
    return {
      ...p,
      handles: [...new Set([
        p.phone, p.email,
        ...(match.status === "matched" ? [...match.contact.phones, ...match.contact.emails] : []),
      ].filter((v): v is string => !!v).map(normalizeHandle).filter(Boolean))],
    };
  });
  const owners = new Map<string, Set<string>>();
  for (const p of targets) for (const h of p.handles) {
    if (!owners.has(h)) owners.set(h, new Set());
    owners.get(h)!.add(p.id);
  }
  const blocked = new Set(config.blockedHandles.map(normalizeHandle));
  return targets.map(p => ({
    ...p,
    handles: p.handles.filter(h => !blocked.has(h) && owners.get(h)?.size === 1).slice(0, 20),
  }));
}

export function boundMessages(messages: CaptureMessage[], now: Date): CaptureMessage[] {
  const ids = new Set<string>();
  let remaining = 20000;
  return [...messages].sort((a, b) => b.sentAt.localeCompare(a.sentAt)).flatMap(m => {
    const time = Date.parse(m.sentAt);
    if (!Number.isFinite(time) || time > now.getTime() || time < now.getTime() - 90 * DAY ||
        ids.size >= 200 || !remaining || ids.has(m.guid) || !m.text.trim()) return [];
    ids.add(m.guid);
    const text = m.text.slice(0, Math.min(2000, remaining));
    remaining -= text.length;
    return [{ guid: m.guid, sentAt: m.sentAt, fromMe: m.fromMe, text }];
  }).reverse();
}

/** Source failures remain retryable; metadata refreshes daily even when messages did not change. */
export async function syncCallSheet(options: {
  api: API;
  contacts: () => Promise<DatingContact[]>;
  open: (source: CallSheetSource, now: Date) => Promise<SourceReader>;
  checkpoint: Checkpoint;
  save: (checkpoint: Checkpoint) => Promise<void>;
  now?: Date;
  maxExtract?: number;
}) {
  const now = options.now ?? new Date();
  const config: CaptureConfig = await options.api();
  if (!SOURCES.some(s => config.sources[s])) {
    options.checkpoint.metadata = {}; options.checkpoint.cues = {};
    await options.save(options.checkpoint);
    return { checked: 0, extracted: 0 };
  }
  if (!config.sourceEpochs || SOURCES.some(s => config.sources[s] && !config.sourceEpochs?.[s])) throw new Error("Source configuration is incomplete");
  const epochs = config.sourceEpochs;
  const targets = resolveCallSheetTargets(config, await options.contacts());
  const checkpoint = options.checkpoint;
  const presentKeys = new Set(targets.flatMap(p => SOURCES.map(s => s + ":" + p.id)));
  for (const cache of [checkpoint.metadata, checkpoint.cues])
    for (const key of Object.keys(cache)) if (!presentKeys.has(key)) delete cache[key];
  let checked = 0, extracted = 0;
  const activityByPerson = new Map<string, { target: Target; values: Partial<Record<CallSheetSource, { reader: SourceReader; activity: Activity }>> }>();
  for (const source of SOURCES) {
    if (!config.sources[source]) {
      for (const cache of [checkpoint.metadata, checkpoint.cues])
        for (const key of Object.keys(cache)) if (key.startsWith(source + ":")) delete cache[key];
      continue;
    }
    try {
      const reader = await options.open(source, now);
      await options.api({ type: "health", source, sourceEpoch: epochs[source], status: "syncing", capturedAt: now.toISOString() });
      let complete = true;
      // Each metadata request is small and bounded. A failed person never makes the whole source ready.
      for (let offset = 0; offset < targets.length; offset += 6) {
        await Promise.all(targets.slice(offset, offset + 6).map(async target => {
          try {
            const activity = reader.activity(target);
            const key = source + ":" + target.id;
            const digest = hash([now.toISOString().slice(0, 10), epochs[source], target.identityKey, target.handles, activity]);
            const payload: CapturePerson = {
              type: "person", extract: false, personId: target.id, identityKey: target.identityKey,
              handles: target.handles, source, sourceEpoch: epochs[source], capturedAt: now.toISOString(),
              coverageStart: new Date(now.getTime() - 365 * DAY).toISOString(),
              ...activity, messages: [],
            };
            if (checkpoint.metadata[key] !== digest) {
              await options.api(payload);
              checkpoint.metadata[key] = digest;
              checked++;
            }
            const person = activityByPerson.get(target.id) ?? { target, values: {} };
            person.values[source] = { reader, activity };
            activityByPerson.set(target.id, person);
          } catch { complete = false; }
        }));
      }
      await options.save(checkpoint);
      await options.api({
        type: "health", source, sourceEpoch: epochs[source], status: complete ? "ready" : "error",
        capturedAt: now.toISOString(),
        ...(complete ? {} : { error: "Some contact activity could not sync. Retrying on the next check." }),
      });
    } catch {
      try { await options.api({ type: "health", source, sourceEpoch: epochs[source], status: "error", capturedAt: now.toISOString(), error: "Messages are unavailable on your Mac. Check app access and try again." }); } catch {}
    }
  }

  // Refresh topics only for people whose last known direct exchange is at least seven days old.
  // Most overdue first, with starred contacts promoted; cached contexts leave room for other candidates.
  const candidates = [...activityByPerson.values()].map(p => {
    const last = Math.max(0, ...Object.values(p.values).map(v => v?.activity.lastContactAt ? Date.parse(v.activity.lastContactAt) : 0));
    const age = last ? (now.getTime() - last) / DAY : 0;
    const cadence = p.target.cadenceDays ?? (p.target.starred || p.target.strength === "close" ? 30 : p.target.strength === "strong" ? 60 : p.target.strength === "weak" ? 180 : 90);
    return { ...p, age, priority: age / cadence + (p.target.starred ? 1 : 0) };
  }).filter(p => p.age >= 7 && p.age <= 90)
    .sort((a, b) => b.priority - a.priority || a.target.id.localeCompare(b.target.id));
  let attempts = 0;
  for (const person of candidates) {
    for (const source of SOURCES) {
      const value = person.values[source];
      if (!value || attempts >= (options.maxExtract ?? 15)) continue;
      try {
        const messages = boundMessages(value.reader.messages(person.target), now);
        if (!messages.length) continue;
        const key = source + ":" + person.target.id;
        const digest = hash([epochs[source], person.target.identityKey, person.target.handles, value.activity, messages]);
        if (checkpoint.cues[key] === digest) continue;
        attempts++;
        const response = await options.api({
          type: "person", personId: person.target.id, identityKey: person.target.identityKey,
          handles: person.target.handles, source, sourceEpoch: epochs[source], capturedAt: now.toISOString(),
          coverageStart: new Date(now.getTime() - 365 * DAY).toISOString(),
          ...value.activity, messages,
        } satisfies CapturePerson);
        if (response.extracted) {
          checkpoint.cues[key] = digest;
          extracted++;
          await options.save(checkpoint);
        }
      } catch { /* Leave the digest absent for the next run. No private content in logs. */ }
    }
  }
  await options.save(checkpoint);
  return { checked, extracted };
}

export async function openCallSheetSource(root: string, source: CallSheetSource, now: Date): Promise<SourceReader> {
  const temp = join(root, source);
  await mkdir(temp);
  const cutoff = new Date(now.getTime() - 365 * DAY).toISOString();
  const textSince = new Date(now.getTime() - 90 * DAY).toISOString();
  if (source === "imessage") {
    const db = snapshotDb(process.env.CALL_SHEET_CHATDB ?? CHAT_DB, temp);
    const index = iMessageHandleIndex(db);
    const rows = sqlite(db, `SELECT h.id AS handle,MAX(CASE WHEN m.date<1000000000000 THEN m.date*1000+978307200000 ELSE m.date/1000000+978307200000 END) AS last,COUNT(DISTINCT m.ROWID) AS count
      FROM message m JOIN chat_message_join cmj ON cmj.message_id=m.ROWID
      JOIN chat_handle_join chj ON chj.chat_id=cmj.chat_id JOIN handle h ON h.ROWID=chj.handle_id
      WHERE cmj.chat_id IN (SELECT chat_id FROM chat_handle_join GROUP BY chat_id HAVING COUNT(*)=1)
      AND m.associated_message_type=0 AND (CASE WHEN m.date<1000000000000 THEN m.date*1000+978307200000 ELSE m.date/1000000+978307200000 END) BETWEEN ${Date.parse(cutoff)} AND ${now.getTime()}
      GROUP BY h.id`) as { handle: string; last: number; count: number }[];
    const map = new Map<string, { last: number; count: number }>();
    for (const row of rows) {
      const h = normalizeHandle(row.handle), prior = map.get(h);
      map.set(h, { last: Math.max(row.last, prior?.last ?? 0), count: row.count + (prior?.count ?? 0) });
    }
    return {
      activity(target) {
        const values = target.handles.flatMap(h => map.has(h) ? [map.get(h)!] : []);
        const last = Math.max(0, ...values.map(v => v.last));
        return { lastContactAt: last ? new Date(last).toISOString() : null, messageCount: values.reduce((n, v) => n + v.count, 0) };
      },
      messages(target) { return readIMessages(db, target.handles.flatMap(h => index.get(h) ?? []), toAppleNs(textSince)); },
    };
  }
  const db = snapshotDb(process.env.CALL_SHEET_WADB ?? WHATSAPP_DB, temp);
  if (whatsAppSchemaProblems(db).length) throw new Error("WhatsApp schema changed");
  const contactTemp = join(root, "whatsapp-identities");
  await mkdir(contactTemp);
  const contactsDb = snapshotDb(process.env.CALL_SHEET_WA_CONTACTS_DB ?? WHATSAPP_CONTACTS_DB, contactTemp);
  const identity = readWhatsAppIdentityMap(contactsDb), sessions = whatsAppSessions(db);
  const rows = sqlite(db, `SELECT ZCHATSESSION AS session,MAX(ZMESSAGEDATE) AS last,COUNT(*) AS count FROM ZWAMESSAGE WHERE ZMESSAGEDATE BETWEEN ${toCoreDataSeconds(cutoff)} AND ${toCoreDataSeconds(now.toISOString())} AND ZMESSAGETYPE IN (0,1,2,3,5,9) GROUP BY ZCHATSESSION`) as { session: number; last: number; count: number }[];
  const map = new Map(rows.map(r => [r.session, r]));
  return {
    activity(target) {
      const values = matchWhatsAppSessions(sessions, target.handles, identity).flatMap(id => map.has(id) ? [map.get(id)!] : []);
      const last = Math.max(0, ...values.map(v => v.last));
      return { lastContactAt: last ? coreDataDate(last).toISOString() : null, messageCount: values.reduce((n, v) => n + v.count, 0) };
    },
    messages(target) { return readWhatsAppMessages(db, sessions, target.handles, toCoreDataSeconds(textSince), identity); },
  };
}

export async function runCallSheetWorker() {
  try { process.loadEnvFile(".env"); } catch {}
  const base = new URL(process.env.CALL_SHEET_SYNC_URL ?? process.env.DATING_SYNC_URL ?? process.env.APP_URL ?? "");
  const token = process.env.CAPTURE_TOKEN;
  if (base.protocol !== "https:" || base.username || base.password || !token) throw new Error("Call sheet connection is not configured");
  const api: API = async body => {
    const response = await fetch(new URL("/api/capture/call-sheet", base), {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error", signal: AbortSignal.timeout(55000),
    });
    if (!response.ok) throw new Error(`Call sheet sync failed (${response.status})`);
    return response.json();
  };
  const dataDir = join(homedir(), "Library/Application Support/personal-os");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, `call-sheet-sync-${hash([base.origin, token])}.json`);
  let checkpoint: Checkpoint = { version: 1, metadata: {}, cues: {} };
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    if (value.version === 1 && value.metadata && value.cues &&
        typeof value.metadata === "object" && !Array.isArray(value.metadata) &&
        typeof value.cues === "object" && !Array.isArray(value.cues)) checkpoint = value;
  } catch {}
  sweepStaleTempRoots("call-sheet-sync-", 2 * 3600_000);
  const root = await mkdtemp(join(tmpdir(), "call-sheet-sync-"));
  try {
    const result = await syncCallSheet({
      api, checkpoint,
      contacts: async () => {
        const cache = await readFreshDatingContacts();
        return cache.status === "ready" ? cache.contacts : [];
      },
      open: (source, now) => openCallSheetSource(root, source, now),
      save: async data => {
        const temp = file + "." + process.pid + ".tmp";
        await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
        await rename(temp, file);
      },
    });
    console.log(`Call sheet check completed: ${result.checked} contact updates, ${result.extracted} conversation summaries.`);
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function installCallSheetWorker() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const label = "com.personal-os.call-sheet-sync";
  const file = join(homedir(), "Library/LaunchAgents", label + ".plist");
  const log = join(homedir(), "Library/Logs/personal-os/call-sheet-sync.log");
  const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const require = createRequire(import.meta.url);
  await mkdir(dirname(file), { recursive: true });
  await mkdir(dirname(log), { recursive: true, mode: 0o700 });
  await writeFile(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(require.resolve("tsx/cli"))}</string><string>${xml(join(root, "scripts/call-sheet-sync.ts"))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>StartInterval</key><integer>3600</integer><key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>`, { mode: 0o600 });
  const domain = `gui/${process.getuid!()}`;
  try { await promisify(execFile)("/bin/launchctl", ["bootout", domain + "/" + label]); } catch {}
  await promisify(execFile)("/bin/launchctl", ["bootstrap", domain, file]);
  console.log("Installed hourly call sheet sync while this Mac is awake.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (process.argv.includes("--install-launchd") ? installCallSheetWorker() : runCallSheetWorker())
    .catch(() => { console.error("Call sheet sync could not finish. Check source status and Mac access."); process.exitCode = 1; });
}
