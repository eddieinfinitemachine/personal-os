#!/usr/bin/env node
/**
 * imessage-stats.ts
 * Purpose: Scan iMessage activity and update Person.lastInteractionAt.
 * Privacy: NEVER selects message.text or content columns. Only ids, timestamps, direction, membership.
 * Usage: pnpm dlx tsx scripts/imessage-stats.ts [--dry-run] [--install-launchd]
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

// Minimal .env loader
try {
  const env = readFileSync(".env", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([\w]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const prisma = new PrismaClient();
const dataDir = join(homedir(), "Library/Application Support/personal-os");
const dryRun = process.argv.includes("--dry-run");
const installLaunchd = process.argv.includes("--install-launchd");

const APPLE_EPOCH_MS = 978307200000;

function normalizePhone(p: string): string {
  const digits = p.replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\+/.test(digits)) return digits;
  return `+${digits.replace(/[^\d]/g, "")}` || "";
}

function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

function convertDate(date: number): Date {
  if (date < 1e12) {
    return new Date((APPLE_EPOCH_MS / 1000 + date) * 1000);
  }
  return new Date(APPLE_EPOCH_MS + date / 1e6);
}

interface MessageRow {
  handle: string;
  from_me: number;
  date: number;
}

interface HandleStats {
  lastAt: Date;
  lastFromMe: boolean;
  count30d: number;
  count90d: number;
  count365d: number;
  total: number;
  sentByMe: number;
  received: number;
}

async function main() {
  const tempDir = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();

  try {
    const messagesDb = join(homedir(), "Library/Messages/chat.db");

    // Copy database
    try {
      cpSync(messagesDb, join(tempDir, "chat.db"));
      const walPath = `${messagesDb}-wal`;
      const shmPath = `${messagesDb}-shm`;
      if (existsSync(walPath)) cpSync(walPath, join(tempDir, "chat.db-wal"));
      if (existsSync(shmPath)) cpSync(shmPath, join(tempDir, "chat.db-shm"));
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EACCES" || err.code === "EPERM") {
        console.error(
          "Full Disk Access is required: System Settings → Privacy & Security → Full Disk Access → enable Knife Terminal (the app running this shell), then restart the terminal."
        );
        process.exit(2);
      }
      throw e;
    }

    // Query sqlite3
    const sql = `
      SELECT h.id AS handle, m.is_from_me AS from_me, m.date AS date
      FROM message m JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.date > 0
      UNION ALL
      SELECT h.id, 1, m.date FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat_handle_join chj ON chj.chat_id = cmj.chat_id
      JOIN handle h ON h.ROWID = chj.handle_id
      WHERE m.is_from_me = 1 AND m.handle_id = 0 AND m.date > 0
    `;

    const result = execFileSync("/usr/bin/sqlite3", ["-json", join(tempDir, "chat.db"), sql], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
    });

    // sqlite3 -json prints nothing at all for an empty result set.
    const messages = (result.trim() ? JSON.parse(result) : []) as MessageRow[];
    const now = Date.now();
    const day30ms = 30 * 24 * 60 * 60 * 1000;
    const day90ms = 90 * 24 * 60 * 60 * 1000;
    const day365ms = 365 * 24 * 60 * 60 * 1000;

    const handleStats: Record<string, HandleStats> = {};

    for (const msg of messages) {
      const handle = msg.handle.includes("@")
        ? normalizeEmail(msg.handle)
        : normalizePhone(msg.handle);
      if (!handle) continue;

      const msgDate = convertDate(msg.date);
      const diffMs = now - msgDate.getTime();

      if (!handleStats[handle]) {
        handleStats[handle] = {
          lastAt: msgDate,
          lastFromMe: msg.from_me === 1,
          count30d: 0,
          count90d: 0,
          count365d: 0,
          total: 0,
          sentByMe: 0,
          received: 0,
        };
      }

      const stats = handleStats[handle];
      if (msgDate > stats.lastAt) {
        stats.lastAt = msgDate;
        stats.lastFromMe = msg.from_me === 1;
      }

      if (diffMs < day30ms) stats.count30d++;
      if (diffMs < day90ms) stats.count90d++;
      if (diffMs < day365ms) stats.count365d++;
      stats.total++;
      if (msg.from_me === 1) stats.sentByMe++;
      else stats.received++;
    }

    // Load contact handles
    const contactHandlesPath = join(dataDir, "contact-handles.json");
    if (!existsSync(contactHandlesPath)) {
      console.error(
        "contact-handles.json not found. Run scripts/link-contacts.ts first."
      );
      process.exit(1);
    }

    const contactHandles = JSON.parse(readFileSync(contactHandlesPath, "utf8")) as Record<
      string,
      { name: string; starred: boolean; phones: string[]; emails: string[] }
    >;

    // Map handles to people
    interface PersonStats extends HandleStats {
      id: string;
      name: string;
      starred: boolean;
    }

    const personStats: Record<string, PersonStats> = {};
    const handleToPersonId: Record<string, string> = {};

    for (const [personId, contact] of Object.entries(contactHandles)) {
      const allHandles = [...contact.phones, ...contact.emails];
      for (const h of allHandles) {
        handleToPersonId[h] = personId;
      }

      const personAll: HandleStats = {
        lastAt: new Date(0),
        lastFromMe: false,
        count30d: 0,
        count90d: 0,
        count365d: 0,
        total: 0,
        sentByMe: 0,
        received: 0,
      };

      for (const h of allHandles) {
        if (handleStats[h]) {
          const hs = handleStats[h];
          if (hs.lastAt > personAll.lastAt) {
            personAll.lastAt = hs.lastAt;
            personAll.lastFromMe = hs.lastFromMe;
          }
          personAll.count30d += hs.count30d;
          personAll.count90d += hs.count90d;
          personAll.count365d += hs.count365d;
          personAll.total += hs.total;
          personAll.sentByMe += hs.sentByMe;
          personAll.received += hs.received;
        }
      }

      if (personAll.total > 0) {
        personStats[personId] = {
          ...personAll,
          id: personId,
          name: contact.name,
          starred: contact.starred,
        };
      }
    }

    // Unmatched handles
    const unmatchedHandles = Object.entries(handleStats)
      .filter(([h]) => !handleToPersonId[h])
      .map(([h, stats]) => ({ handle: h, ...stats }))
      .sort((a, b) => b.count90d - a.count90d)
      .slice(0, 40);

    // DB write
    let bumped = 0;
    if (!dryRun) {
      const founderEmail = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
      const founder = await prisma.user.findUnique({ where: { email: founderEmail } });
      if (!founder) throw new Error(`founder user (${founderEmail}) not found`);

      for (const [personId, stats] of Object.entries(personStats)) {
        const person = await prisma.person.findUnique({ where: { id: personId } });
        if (!person) continue;

        if (!person.lastInteractionAt || stats.lastAt > person.lastInteractionAt) {
          await prisma.person.update({
            where: { id: personId },
            data: { lastInteractionAt: stats.lastAt },
          });
          bumped++;
        }
      }
    }

    // Write output
    mkdirSync(dataDir, { recursive: true });
    const dateStr = new Date().toISOString().split("T")[0];
    const outputPath = join(
      dataDir,
      `imessage-stats-${dateStr}.json`
    );

    const people = Object.values(personStats).sort((a, b) => b.count90d - a.count90d);
    const output = {
      generatedAt: new Date().toISOString(),
      people,
      unmatchedHandles,
      summary: {
        peopleWithStats: people.length,
        bumped,
        totalMessages: messages.length,
      },
    };

    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    // Print tables
    console.log("\nTop 25 by 90d count:");
    console.table(
      people.slice(0, 25).map((p) => ({
        name: p.name,
        starred: p.starred,
        count90d: p.count90d,
        lastAt: p.lastAt.toISOString().split("T")[0],
      }))
    );

    console.log("\nStarred people not contacted in 90+ days:");
    const old90d = new Date(now - day90ms);
    const starred = people.filter((p) => p.starred && p.lastAt < old90d);
    console.table(
      starred.map((p) => ({
        name: p.name,
        count90d: p.count90d,
        lastAt: p.lastAt.toISOString().split("T")[0],
      }))
    );

    console.log("\nTop 15 unmatched handles by 90d count:");
    console.table(
      unmatchedHandles.slice(0, 15).map((h) => ({
        handle: h.handle,
        count90d: h.count90d,
        total: h.total,
      }))
    );

    console.log("\nSummary:");
    console.table(output.summary);

    // Install launchd
    if (installLaunchd) {
      const uid = userInfo().uid;
      const launchAgentsDir = join(homedir(), "Library/LaunchAgents");
      const plistPath = join(launchAgentsDir, "com.personal-os.imessage-stats.plist");

      mkdirSync(launchAgentsDir, { recursive: true });

      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.personal-os.imessage-stats</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>-lc</string>
        <string>cd /Users/eddie/Code/active/personal-os && pnpm dlx tsx scripts/imessage-stats.ts</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>3</integer>
        <key>Minute</key>
        <integer>30</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${join(homedir(), "Library/Logs/personal-os/imessage-stats.log")}</string>
    <key>StandardErrorPath</key>
    <string>${join(homedir(), "Library/Logs/personal-os/imessage-stats.log")}</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>`;

      const logsDir = join(homedir(), "Library/Logs/personal-os");
      mkdirSync(logsDir, { recursive: true });

      writeFileSync(plistPath, plistContent);

      // Bootstrap launchctl
      try {
        execFileSync("launchctl", ["bootout", `gui/${uid}`, plistPath]);
      } catch {}

      execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);

      console.log(
        `\nLaunchd plist installed. To run now: launchctl kickstart -k gui/${uid}/com.personal-os.imessage-stats`
      );
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
