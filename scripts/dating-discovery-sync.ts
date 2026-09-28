/** Opt-in discovery only. Never import this module to read databases: execution requires runDiscoverySync(). */
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeHandle } from "../src/lib/dating";
import { CHAT_DB, WHATSAPP_DB, dbStatus, readWhatsAppIdentityMap, snapshotDb, sqlite, whatsAppSchemaProblems, whatsAppSessions } from "../src/lib/dating-message-readers";
import { decodeAttributedBody } from "../src/lib/imessage-body";
import { APPLE_EPOCH_MS, appleDate, coreDataDate, matchWhatsAppSessions, toCoreDataSeconds, whatsappJidPhone } from "../src/lib/dating-message-sync";
import { hash } from "../src/lib/dating-intake/contracts";
import { discoverableThread, runMessageDiscovery, type DiscoveryCheckpoint, type DiscoveryConfig, type DiscoveryMessage, type DiscoveryThread, type Position } from "../src/lib/dating-intake/message-discovery";

const PAGE_SIZE = 100;
const OVERLAP = 3;
function positionSQL(column: string, id: string, value: Position, operator: ">" | "<=") {
  if (typeof value.date !== "string" || !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value.date) || !Number.isSafeInteger(value.id)) throw new Error("Invalid local message position");
  return operator === ">" ? `(${column} > ${value.date} OR (${column} = ${value.date} AND ${id} > ${value.id}))` : `(${column} < ${value.date} OR (${column} = ${value.date} AND ${id} <= ${value.id}))`;
}
/** Thread IDs/handles only. Content is read later for eligible, nonexcluded threads. */
export function listDiscoveryThreads(chatDb: string | null, waDb: string | null, identities: ReadonlyMap<string, string> = new Map()): DiscoveryThread[] {
  const result: DiscoveryThread[] = [];
  if (chatDb) {
    const rows = sqlite(chatDb, `SELECT c.ROWID AS id, h.id AS handle FROM chat c
      JOIN chat_handle_join ch ON ch.chat_id = c.ROWID JOIN handle h ON h.ROWID = ch.handle_id
      WHERE c.style = 45 AND c.ROWID IN (SELECT chat_id FROM chat_handle_join GROUP BY chat_id HAVING COUNT(*) = 1)`) as { id: number; handle: string }[];
    for (const row of rows) result.push({ id: String(row.id), source: "imessage", handle: normalizeHandle(row.handle), oneToOne: true });
  }
  if (waDb) {
    for (const session of whatsAppSessions(waDb)) {
      const phone = whatsappJidPhone(session.jid) ?? (session.jid ? identities.get(session.jid.replace(/:\d+@/, "@")) : undefined);
      if (!phone || !matchWhatsAppSessions([session], [phone], identities).length) continue;
      result.push({ id: String(session.pk), source: "whatsapp", handle: phone, oneToOne: true });
    }
  }
  return result;
}
export function readDiscoveryPage(db: string, thread: DiscoveryThread, from: Position | null, since: string, through?: Position) {
  if (!/^\d+$/.test(thread.id)) throw new Error("Invalid local thread identity");
  const imessage = thread.source === "imessage";
  const dateColumn = imessage ? "m.date" : "m.ZMESSAGEDATE";
  const idColumn = imessage ? "m.ROWID" : "m.Z_PK";
  if (!Number.isFinite(Date.parse(since))) throw new Error("Invalid discovery date");
  const rangeStart = imessage ? (BigInt(Date.parse(since) - APPLE_EPOCH_MS) * 1_000_000n).toString() : toCoreDataSeconds(since).toString();
  const select = imessage ? `SELECT m.ROWID AS id,quote(m.date) AS date,m.guid AS guid,m.is_from_me AS from_me,m.text AS text,hex(m.attributedBody) AS body FROM message m JOIN chat_message_join cm ON cm.message_id=m.ROWID` : `SELECT m.Z_PK AS id,quote(m.ZMESSAGEDATE) AS date,m.ZSTANZAID AS guid,m.ZISFROMME AS from_me,m.ZTEXT AS text,NULL AS body FROM ZWAMESSAGE m`;
  const scope = imessage ? `cm.chat_id=${thread.id} AND m.associated_message_type=0` : `m.ZCHATSESSION=${thread.id} AND m.ZMESSAGETYPE=0 AND m.ZTEXT IS NOT NULL`;
  const after = from ? positionSQL(dateColumn, idColumn, from, ">") : "1=1";
  const upper = through ? `AND ${positionSQL(dateColumn, idColumn, through, "<=")}` : "";
  const order = `${dateColumn},${idColumn}`;
  type Row = { id: number; date: string; guid: string | null; from_me: number; text: string | null; body: string | null };
  const rows = sqlite(db, `${select} WHERE ${scope} AND ${dateColumn}>=${rangeStart} AND ${after} ${upper} ORDER BY ${order} LIMIT ${PAGE_SIZE + 1}`) as Row[];
  const selected = rows.slice(0, PAGE_SIZE);
  if (!selected.length) return { messages: [], through: null, hasMore: false };
  const overlap = from ? sqlite(db, `${select} WHERE ${scope} AND ${dateColumn}>=${rangeStart} AND ${positionSQL(dateColumn, idColumn, from, "<=")} ORDER BY ${dateColumn} DESC,${idColumn} DESC LIMIT ${OVERLAP}`) as Row[] : [];
  const messages: DiscoveryMessage[] = [...overlap.reverse(), ...selected].flatMap((row) => {
    if (!row.guid) return [];
    const text = row.text?.replace(/￼/g, "").trim() || (imessage ? decodeAttributedBody(row.body ? Buffer.from(row.body, "hex") : null)?.trim() : null);
    if (!text) return [];
    return [{ position: { date: row.date, id: row.id }, guid: row.guid, sentAt: (imessage ? appleDate(Number(row.date)) : coreDataDate(Number(row.date))).toISOString(), fromMe: row.from_me === 1, text }];
  });
  const last = selected.at(-1)!;
  const end = { date: last.date, id: last.id };
  const more = through ? (sqlite(db, `SELECT ${idColumn} FROM ${imessage ? "message" : "ZWAMESSAGE"} m ${imessage ? "JOIN chat_message_join cm ON cm.message_id=m.ROWID" : ""} WHERE ${scope} AND ${positionSQL(dateColumn, idColumn, end, ">")} LIMIT 1`).length > 0) : rows.length > PAGE_SIZE;
  return { messages, through: end, hasMore: more };
}

export async function runDiscoverySync(options: { base: string; token: string; chatDbPath?: string; waDbPath?: string; contactsDbPath?: string; noWhatsApp?: boolean; checkpointRoot?: string; fetch?: typeof fetch }) {
  const origin = new URL(options.base);
  if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("Message discovery requires an HTTPS Personal OS address");
  const started = Date.now();
  const deadline = started + 45_000;
  const api = async (body?: object) => {
    const response = await (options.fetch ?? fetch)(new URL("/api/capture/dating/discovery", origin), {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
    if (!response.ok) throw new Error(`Message discovery request failed (${response.status})`);
    return response.json();
  };
  const config = await api() as DiscoveryConfig;
  if (!config.enabled || !config.stateId) return { skipped: true, sent: 0, complete: false };
  const root = options.checkpointRoot ?? join(homedir(), "Library/Application Support/personal-os/dating-discovery");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, `${hash(`${origin.origin}:${config.stateId}`)}.json`);
  const lock = `${path}.lock`;
  try {
    try { if (Date.now() - statSync(lock).mtimeMs > 120_000) rmSync(lock); } catch {}
    writeFileSync(lock, "", { flag: "wx", mode: 0o600 });
  } catch { return { skipped: true, sent: 0, complete: false }; }
  let temp: string | undefined;
  try {
    let checkpoint: DiscoveryCheckpoint = { version: 1, stateId: config.stateId, nextThread: 0, threads: {} };
    try {
      const stored = JSON.parse(readFileSync(path, "utf8"));
      if (stored.version === 1 && stored.stateId === config.stateId && stored.threads && typeof stored.nextThread === "number") checkpoint = stored;
    } catch {}
    temp = mkdtempSync(join(tmpdir(), "dating-discovery-"));
    const open = (source: string, sourcePath: string) => {
      if (dbStatus(sourcePath) === "missing") return null;
      const folder = join(temp!, source); mkdirSync(folder); return snapshotDb(sourcePath, folder);
    };
    const chatDb = open("imessage", options.chatDbPath ?? process.env.DATING_SYNC_CHATDB ?? CHAT_DB);
    const waDb = options.noWhatsApp ? null : open("whatsapp", options.waDbPath ?? process.env.DATING_SYNC_WADB ?? WHATSAPP_DB);
    if (!chatDb && !waDb) throw new Error("No message databases are available");
    if (waDb && whatsAppSchemaProblems(waDb).length) throw new Error("WhatsApp message format needs attention");
    let identities = new Map<string, string>();
    if (waDb) {
      const contacts = open("contacts", options.contactsDbPath ?? process.env.DATING_SYNC_WA_CONTACTS_DB ?? join(dirname(options.waDbPath ?? process.env.DATING_SYNC_WADB ?? WHATSAPP_DB), "ContactsV2.sqlite"));
      if (contacts) identities = readWhatsAppIdentityMap(contacts);
    }
    return await runMessageDiscovery({ config, checkpoint, maxMs: Math.max(0, deadline - Date.now() - 2_000),
      list: async () => listDiscoveryThreads(chatDb, waDb, identities).filter((thread) => discoverableThread(thread, new Set(config.excludedHandles))),
      read: async (thread, from, since, through) => readDiscoveryPage(thread.source === "imessage" ? chatDb! : waDb!, thread, from, since, through),
      send: async (envelope) => api({ action: "record", envelope }),
      save: async (value) => { const pending = `${path}.tmp`; writeFileSync(pending, JSON.stringify(value), { mode: 0o600 }); renameSync(pending, path); },
      progress: async (value) => {
        const unavailable = !chatDb || (!options.noWhatsApp && !waDb);
        await api({ action: "progress", ...value, ...(unavailable ? { complete: false, remaining: Math.max(value.remaining, 1), error: true } : {}) });
      },
    });
  } catch {
    // Never include message text, handles, paths or credentials in error output.
    try { await api({ action: "progress", complete: false, coverageStart: new Date(started - 30 * 86_400_000).toISOString(), coverageEnd: new Date(started).toISOString(), remaining: 1, error: true }); } catch {}
    throw new Error("Message discovery could not finish. Check source status and Mac access, then retry.");
  } finally { if (temp) rmSync(temp, { recursive: true, force: true }); rmSync(lock, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDiscoverySync({ base: process.env.DATING_SYNC_URL ?? process.env.APP_URL ?? "", token: process.env.CAPTURE_TOKEN ?? "", noWhatsApp: process.argv.includes("--no-whatsapp") })
    .then((result) => console.log(`Message discovery: ${result.skipped ? "not enabled or already running" : `${result.sent} source segments sent${result.complete ? ", scan complete" : ", more work remains"}`}`))
    .catch(() => { console.error("Message discovery failed; check source status and Mac access."); process.exitCode = 1; });
}
