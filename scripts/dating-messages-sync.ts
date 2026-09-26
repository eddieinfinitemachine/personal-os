#!/usr/bin/env node
/**
 * dating-messages-sync.ts
 * Purpose: Copy iMessage threads for the people on /dating into EC.
 * Privacy: reads message text ONLY for 1:1 chats with handles you added to a
 * person on /dating. Every other thread is never selected.
 * Usage: pnpm dlx tsx scripts/dating-messages-sync.ts [--dry-run] [--full] [--install-launchd]
 *   --full             ignore the last-synced time and resend everything (deduped server-side)
 *   --install-launchd  run every 30 minutes in the background
 * Env (.env): CAPTURE_TOKEN, and DATING_SYNC_URL or APP_URL (the EC base URL).
 * Needs Full Disk Access for the terminal running it.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { normalizeHandle } from "../src/lib/dating";
import { decodeAttributedBody } from "../src/lib/imessage-body";

try {
  const env = readFileSync(".env", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([\w]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const dryRun = process.argv.includes("--dry-run");
const full = process.argv.includes("--full");
const installLaunchd = process.argv.includes("--install-launchd");

const BASE = (process.env.DATING_SYNC_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.CAPTURE_TOKEN ?? "";
const APPLE_EPOCH_MS = 978307200000;
const BATCH = 1000;

type Target = { id: string; name: string; handles: string[]; since: string | null };
type Row = { guid: string; date: number; from_me: number; text: string | null; body: string | null };

function appleDate(date: number): Date {
  // Pre-High Sierra rows are seconds, later ones nanoseconds.
  return date < 1e12 ? new Date(APPLE_EPOCH_MS + date * 1000) : new Date(APPLE_EPOCH_MS + date / 1e6);
}

function toAppleNs(iso: string): number {
  return (new Date(iso).getTime() - APPLE_EPOCH_MS) * 1e6;
}

function sqlite(db: string, sql: string): unknown[] {
  const out = execFileSync("/usr/bin/sqlite3", ["-json", db, sql], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  // sqlite3 -json prints nothing at all for an empty result set.
  return out.trim() ? (JSON.parse(out) as unknown[]) : [];
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

async function main() {
  if (!BASE || !TOKEN) {
    console.error("Set CAPTURE_TOKEN and DATING_SYNC_URL (or APP_URL) in .env");
    process.exit(1);
  }
  if (installLaunchd) return install();

  const { people } = (await api("/api/capture/dating")) as { people: Target[] };
  if (!people.length) {
    console.log("No one on /dating has a phone or email yet. Add one to sync their texts.");
    return;
  }

  const tempDir = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
  try {
    const src = join(homedir(), "Library/Messages/chat.db");
    try {
      cpSync(src, join(tempDir, "chat.db"));
      for (const ext of ["-wal", "-shm"]) {
        if (existsSync(src + ext)) cpSync(src + ext, join(tempDir, `chat.db${ext}`));
      }
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EACCES" || err.code === "EPERM") {
        console.error(
          "Full Disk Access is required: System Settings → Privacy & Security → Full Disk Access → enable your terminal, then restart it.",
        );
        process.exit(2);
      }
      throw e;
    }
    const db = join(tempDir, "chat.db");

    // Handle ids only (no content) so we can match normalized phones/emails.
    const handles = sqlite(db, "SELECT ROWID AS rowid, id FROM handle") as { rowid: number; id: string }[];
    const byHandle = new Map<string, number[]>();
    for (const h of handles) {
      const n = normalizeHandle(h.id);
      if (!n) continue;
      byHandle.set(n, [...(byHandle.get(n) ?? []), h.rowid]);
    }

    for (const p of people) {
      const rowids = p.handles.flatMap((h) => byHandle.get(h) ?? []);
      if (!rowids.length) {
        console.log(`${p.name}: no iMessage thread for ${p.handles.join(", ")}`);
        continue;
      }
      // Back off a day from the last sync; the server dedupes by guid.
      const since = !full && p.since ? Math.max(0, toAppleNs(p.since) - 86_400e9) : 0;
      const ids = rowids.map(Number).join(",");
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
           AND m.date > ${Math.floor(since)}
         ORDER BY m.date`,
      ) as Row[];

      const seen = new Set<string>();
      const messages = rows.flatMap((r) => {
        if (seen.has(r.guid)) return [];
        seen.add(r.guid);
        const text = (r.text?.replace(/￼/g, "").trim() || null) ?? decodeAttributedBody(r.body ? Buffer.from(r.body, "hex") : null);
        if (!text) return [];
        return [{ guid: r.guid, sentAt: appleDate(r.date).toISOString(), fromMe: r.from_me === 1, text }];
      });

      if (dryRun) {
        console.log(`${p.name}: ${messages.length} messages would be sent`);
        continue;
      }
      let added = 0;
      for (let i = 0; i < messages.length; i += BATCH) {
        const res = (await api("/api/capture/dating", {
          method: "POST",
          body: JSON.stringify({ personId: p.id, messages: messages.slice(i, i + BATCH) }),
        })) as { added: number };
        added += res.added;
      }
      console.log(`${p.name}: ${messages.length} read, ${added} new`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function install() {
  const uid = userInfo().uid;
  const label = "com.personal-os.dating-messages-sync";
  const plistPath = join(homedir(), "Library/LaunchAgents", `${label}.plist`);
  const logPath = join(homedir(), "Library/Logs/personal-os/dating-messages-sync.log");
  mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
  mkdirSync(join(homedir(), "Library/Logs/personal-os"), { recursive: true });
  writeFileSync(
    plistPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>-lc</string>
        <string>cd ${process.cwd()} &amp;&amp; pnpm dlx tsx scripts/dating-messages-sync.ts</string>
    </array>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`,
  );
  try {
    execFileSync("launchctl", ["bootout", `gui/${uid}`, plistPath]);
  } catch {}
  execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
  console.log(`Installed. Syncs every 30 minutes. Log: ${logPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
