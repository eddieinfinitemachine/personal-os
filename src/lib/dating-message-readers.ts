// Local message databases read by scripts/dating-messages-sync.ts: iMessage
// (~/Library/Messages/chat.db) and WhatsApp Desktop
// (~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite).
// Node-only (sqlite3 CLI). Every read runs against a temp snapshot, so the
// live app's database is only ever copied: never opened, locked or written.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { normalizeHandle } from "./dating";
import { decodeAttributedBody } from "./imessage-body";
import {
  mapIMessageRow,
  mapWhatsAppRow,
  matchWhatsAppSessions,
  type IMessageRow,
  type SyncedMessage,
  type WhatsAppRow,
  type WhatsAppSession,
} from "./dating-message-sync";

export const CHAT_DB = join(homedir(), "Library/Messages/chat.db");
export const WHATSAPP_DB = join(
  homedir(),
  "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite",
);

// Only ever pointed at a temp snapshot (see snapshotDb), never the live file.
// Not opened with -readonly: a WAL-mode copy then fails to open whenever the
// app had no -shm file on disk, and writes to the copy are harmless.
export function sqlite(db: string, sql: string): unknown[] {
  const out = execFileSync("/usr/bin/sqlite3", ["-json", db, sql], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  // sqlite3 -json prints nothing at all for an empty result set.
  return out.trim() ? (JSON.parse(out) as unknown[]) : [];
}

/** Thrown when macOS privacy (TCC) blocks reading a message database. */
export class FullDiskAccessError extends Error {
  constructor(public path: string) {
    super(`No permission to read ${path}`);
  }
}

/** The real node binary (symlinks resolved) that Full Disk Access must be granted to. */
export function nodeBinary(): string {
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

export function fullDiskAccessHelp(path: string): string {
  return [
    `Full Disk Access is required to read ${path}.`,
    "System Settings → Privacy & Security → Full Disk Access → + → add this binary (⌘⇧G to paste the path):",
    `  ${nodeBinary()}`,
    "Running from a terminal? Enable the terminal app too, then restart it. Under launchd the job runs",
    "/bin/zsh → node; if it still fails there, also add /bin/zsh. Re-grant after a node upgrade (the path changes).",
  ].join("\n");
}

const isPermission = (e: unknown) => {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === "EACCES" || code === "EPERM";
};

/**
 * "missing" when the file isn't there (e.g. WhatsApp Desktop not installed);
 * throws FullDiskAccessError when macOS won't even let us look.
 */
export function dbStatus(path: string): "ok" | "missing" {
  try {
    statSync(path);
    return "ok";
  } catch (e) {
    if (isPermission(e)) throw new FullDiskAccessError(path);
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw e;
  }
}

/**
 * Copy a live SQLite db (plus -wal/-shm, so uncheckpointed writes are
 * included) into `tempDir`. Returns the copy's path.
 */
export function snapshotDb(src: string, tempDir: string): string {
  const dest = join(tempDir, basename(src));
  try {
    cpSync(src, dest);
    for (const ext of ["-wal", "-shm"]) {
      if (existsSync(src + ext)) cpSync(src + ext, dest + ext);
    }
  } catch (e) {
    if (isPermission(e)) throw new FullDiskAccessError(src);
    throw e;
  }
  return dest;
}

// ---------------------------------------------------------------- iMessage

/** Normalized handle ("+15551234567" / email) → handle ROWIDs. Ids only, no content. */
export function iMessageHandleIndex(db: string): Map<string, number[]> {
  const handles = sqlite(db, "SELECT ROWID AS rowid, id FROM handle") as { rowid: number; id: string }[];
  const byHandle = new Map<string, number[]>();
  for (const h of handles) {
    const n = normalizeHandle(h.id);
    if (!n) continue;
    byHandle.set(n, [...(byHandle.get(n) ?? []), h.rowid]);
  }
  return byHandle;
}

/** Messages from 1:1 chats with these handle ROWIDs, newer than `sinceNs` (Apple ns). */
export function readIMessages(db: string, rowids: number[], sinceNs: number): SyncedMessage[] {
  if (!rowids.length) return [];
  const ids = rowids.map((n) => Math.trunc(Number(n))).join(",");
  const rows = sqlite(
    db,
    `SELECT m.guid, m.date, m.is_from_me AS from_me, m.text, hex(m.attributedBody) AS body
     FROM message m
     JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
     WHERE cmj.chat_id IN (
       SELECT chat_id FROM chat_handle_join
       WHERE handle_id IN (${ids})
         AND chat_id IN (SELECT chat_id FROM chat_handle_join GROUP BY chat_id HAVING COUNT(*) = 1)
     )
       AND m.associated_message_type = 0
       AND m.date > ${Math.max(0, Math.floor(sinceNs))}
     ORDER BY m.date`,
  ) as (Omit<IMessageRow, "decoded"> & { body: string | null })[];

  const seen = new Set<string>();
  return rows.flatMap((r) => {
    if (seen.has(r.guid)) return [];
    seen.add(r.guid);
    const decoded = r.text?.replace(/￼/g, "").trim() ? null : decodeAttributedBody(r.body ? Buffer.from(r.body, "hex") : null);
    const m = mapIMessageRow({ ...r, decoded });
    return m ? [m] : [];
  });
}

// ---------------------------------------------------------------- WhatsApp

const WA_REQUIRED: Record<string, string[]> = {
  ZWACHATSESSION: ["Z_PK", "ZCONTACTJID", "ZSESSIONTYPE"],
  ZWAMESSAGE: ["Z_PK", "ZCHATSESSION", "ZISFROMME", "ZTEXT", "ZMESSAGEDATE", "ZSTANZAID", "ZMESSAGETYPE"],
};

/** Missing "TABLE.COLUMN"s, so a WhatsApp schema change is a clear log line, not a crash. */
export function whatsAppSchemaProblems(db: string): string[] {
  const problems: string[] = [];
  for (const [table, cols] of Object.entries(WA_REQUIRED)) {
    const have = new Set(
      (sqlite(db, `SELECT name FROM pragma_table_info('${table}')`) as { name: string }[]).map((c) => c.name),
    );
    for (const c of cols) if (!have.has(c)) problems.push(`${table}.${c}`);
  }
  return problems;
}

/** Chat sessions (ids and JIDs only, no content). */
export function whatsAppSessions(db: string): WhatsAppSession[] {
  return sqlite(db, "SELECT Z_PK AS pk, ZCONTACTJID AS jid, ZSESSIONTYPE AS type FROM ZWACHATSESSION") as WhatsAppSession[];
}

/** Text messages in the 1:1 sessions matching `handles`, newer than `sinceSeconds` (Core Data). */
export function readWhatsAppMessages(
  db: string,
  sessions: WhatsAppSession[],
  handles: string[],
  sinceSeconds: number,
): SyncedMessage[] {
  const pks = matchWhatsAppSessions(sessions, handles);
  if (!pks.length) return [];
  const rows = sqlite(
    db,
    `SELECT ZSTANZAID AS stanza, ZMESSAGEDATE AS date, ZISFROMME AS from_me, ZTEXT AS text, ZMESSAGETYPE AS type
     FROM ZWAMESSAGE
     WHERE ZCHATSESSION IN (${pks.map((n) => Math.trunc(Number(n))).join(",")})
       AND ZMESSAGETYPE = 0
       AND ZTEXT IS NOT NULL
       AND ZMESSAGEDATE > ${Math.max(0, sinceSeconds)}
     ORDER BY ZMESSAGEDATE`,
  ) as WhatsAppRow[];

  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const m = mapWhatsAppRow(r);
    if (!m || seen.has(m.guid)) return [];
    seen.add(m.guid);
    return [m];
  });
}
