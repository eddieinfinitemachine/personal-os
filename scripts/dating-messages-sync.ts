#!/usr/bin/env node
/**
 * dating-messages-sync.ts
 * Purpose: Copy iMessage and WhatsApp threads for the people on /dating into EC.
 * Privacy: reads message text ONLY for 1:1 chats with handles you added to a
 * person on /dating. Group chats, broadcasts/status and every other thread are
 * never selected by the saved-person import. Separately enabled discovery may
 * inspect recent one-to-one conversations; its server setting defaults off.
 * Usage: pnpm dlx tsx scripts/dating-messages-sync.ts [--dry-run] [--full] [--no-whatsapp] [--install-launchd]
 *   --person-id=ID     limit all lookup/import/summary work to one saved person
 *   --diagnose-whatsapp log schema and exact-number match counts, never message text
 *   --dry-run          read and count, send nothing
 *   --full             ignore the last-synced times and resend everything (deduped server-side)
 *   --no-whatsapp      skip WhatsApp (on by default; skipped with a log line if WhatsApp Desktop isn't installed)
 *   --install-launchd  run every 30 minutes in the background
 * Env (.env): CAPTURE_TOKEN, and DATING_SYNC_URL or APP_URL (the EC base URL).
 *   DATING_SYNC_CHATDB / DATING_SYNC_WADB override the database paths (testing).
 *
 * Full Disk Access: both ~/Library/Messages and WhatsApp's app-group container
 * (~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared) are covered
 * by Full Disk Access; one grant covers both. Run by hand, the terminal app
 * needs it. The launchd job (/bin/zsh -lc "... pnpm dlx tsx ...") reads the
 * databases from the node binary, so grant Full Disk Access to that binary
 * (the error message prints its exact resolved path; re-grant after a node
 * upgrade). If launchd runs still fail, also grant /bin/zsh, the job's program.
 */

import { runDiscoverySync } from "./dating-discovery-sync";
import {
  whatsappBackfillKey,
  readWhatsAppBackfills,
  markWhatsAppBackfill,
} from "./dating-whatsapp-checkpoint";
import { diagnoseWhatsAppPhone } from "./dating-whatsapp-diagnostic";
import { resolveAddedContacts } from "./dating-contact-sync";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import {
  CHAT_DB,
  WHATSAPP_DB,
  FullDiskAccessError,
  dbStatus,
  fullDiskAccessHelp,
  iMessageHandleIndex,
  readIMessages,
  readWhatsAppMessages,
  readWhatsAppIdentityMap,
  snapshotDb,
  whatsAppSchemaProblems,
  whatsAppSessions,
} from "../src/lib/dating-message-readers";
import {
  summaryLine,
  toAppleNs,
  toCoreDataSeconds,
  type CaptureSource,
  type SyncedMessage,
  type WhatsAppSession,
} from "../src/lib/dating-message-sync";

try {
  const env = readFileSync(".env", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([\w]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const dryRun = process.argv.includes("--dry-run");
const personId = process.argv
  .find((arg) => arg.startsWith("--person-id="))
  ?.slice("--person-id=".length);
const diagnoseWhatsApp = process.argv.includes("--diagnose-whatsapp");
const full = process.argv.includes("--full");
const noWhatsApp = process.argv.includes("--no-whatsapp");
const installLaunchd = process.argv.includes("--install-launchd");

const BASE = (process.env.DATING_SYNC_URL ?? process.env.APP_URL ?? "").replace(
  /\/$/,
  "",
);
const TOKEN = process.env.CAPTURE_TOKEN ?? "";
const CHAT_DB_PATH = process.env.DATING_SYNC_CHATDB || CHAT_DB;
const WA_DB_PATH = process.env.DATING_SYNC_WADB || WHATSAPP_DB;
const WA_CONTACTS_DB_PATH =
  process.env.DATING_SYNC_WA_CONTACTS_DB ||
  join(dirname(WA_DB_PATH), "ContactsV2.sqlite");
const BATCH = 1000;
const DAY_S = 86_400;

type Target = {
  id: string;
  name: string;
  handles: string[];
  since: string | null;
  whatsappSince?: string | null;
};

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = await res.text();
  if (!res.ok)
    throw new Error(
      `${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`,
    );
  return JSON.parse(body);
}

async function send(
  personId: string,
  source: CaptureSource,
  messages: SyncedMessage[],
): Promise<number> {
  let added = 0;
  for (let i = 0; i < messages.length; i += BATCH) {
    const res = (await api("/api/capture/dating", {
      method: "POST",
      body: JSON.stringify({
        personId,
        source,
        messages: messages.slice(i, i + BATCH),
      }),
    })) as { added: number };
    added += res.added;
  }
  return added;
}

/** Snapshot a db into tempDir, or null (with a log line) when it isn't there. */
function open(label: string, path: string, tempDir: string): string | null {
  if (dbStatus(path) === "missing") {
    console.log(`${label} database not found at ${path}; skipping ${label}.`);
    return null;
  }
  return snapshotDb(path, tempDir);
}

async function main() {
  if (personId !== undefined && !personId.trim())
    throw new Error("--person-id requires a nonempty ID");
  if (!BASE || !TOKEN) {
    console.error("Set CAPTURE_TOKEN and DATING_SYNC_URL (or APP_URL) in .env");
    process.exit(1);
  }
  if (installLaunchd) return install();

  // Discovery has its own explicit server opt-in and never runs during a scoped/dry/diagnostic import.
  if (!dryRun && !personId && !diagnoseWhatsApp) {
    try {
      await runDiscoverySync({
        base: BASE,
        token: TOKEN,
        chatDbPath: CHAT_DB_PATH,
        waDbPath: WA_DB_PATH,
        contactsDbPath: WA_CONTACTS_DB_PATH,
        noWhatsApp,
      });
    } catch {
      console.warn(
        "Optional message discovery could not finish; saved-person sync will continue.",
      );
    }
  }

  // Contact lookup is automatic and refreshes its local directory before matching.
  if (!dryRun && !diagnoseWhatsApp) {
    try {
      await resolveAddedContacts({
        api: (path, body) =>
          api(
            path,
            body ? { method: "POST", body: JSON.stringify(body) } : undefined,
          ),
        personId,
      });
    } catch {
      console.warn(
        "Contact lookup could not finish; saved-number sync will continue.",
      );
    }
  }

  const { people: allPeople } = (await api("/api/capture/dating")) as {
    people: Target[];
  };
  const people = allPeople.filter((p) => !personId || p.id === personId);
  if (!people.length) {
    console.log(
      "No matching contact details found yet. Automatic lookup will retry.",
    );
    return;
  }

  const tempDir = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
  try {
    mkdirSync(join(tempDir, "imessage"));
    mkdirSync(join(tempDir, "whatsapp"));
    mkdirSync(join(tempDir, "whatsapp-contacts"));
    const chatDb = open("iMessage", CHAT_DB_PATH, join(tempDir, "imessage"));
    if (!chatDb && process.argv.includes("--require-imessage"))
      throw new Error(
        "iMessage is unavailable; automatic contact import will retry.",
      );
    let waDb = noWhatsApp
      ? null
      : open("WhatsApp", WA_DB_PATH, join(tempDir, "whatsapp"));
    const waSnapshot = waDb;
    if (waDb) {
      const problems = whatsAppSchemaProblems(waDb);
      if (problems.length) {
        console.log(
          `WhatsApp database has an unexpected schema (missing ${problems.join(", ")}); skipping WhatsApp.`,
        );
        waDb = null;
      }
    }
    if (!chatDb && !waDb && !(diagnoseWhatsApp && waSnapshot)) return;

    const byHandle = chatDb
      ? iMessageHandleIndex(chatDb)
      : new Map<string, number[]>();
    const sessions: WhatsAppSession[] = waDb ? whatsAppSessions(waDb) : [];
    let identities = new Map<string, string>();
    if (waDb) {
      try {
        const contactsDb = open(
          "WhatsApp contacts",
          WA_CONTACTS_DB_PATH,
          join(tempDir, "whatsapp-contacts"),
        );
        if (contactsDb) identities = readWhatsAppIdentityMap(contactsDb);
      } catch {
        console.warn(
          "WhatsApp contact mapping unavailable; only direct phone matches will be imported.",
        );
      }
    }

    const backfills = readWhatsAppBackfills();
    for (const p of people) {
      if (diagnoseWhatsApp && waSnapshot) {
        for (const phone of p.handles.filter((h) =>
          /^\+[1-9]\d{6,14}$/.test(h),
        )) {
          console.log(
            JSON.stringify({
              whatsappDiagnostic: true,
              personId: p.id,
              ...diagnoseWhatsAppPhone(waSnapshot, phone),
            }),
          );
        }
      }
      // Back off a day from each source's last sync; the server dedupes by guid.
      const imSince = !full && p.since ? toAppleNs(p.since) - DAY_S * 1e9 : 0;
      const backfillKey = whatsappBackfillKey(
        BASE,
        p.id,
        p.handles,
        identities,
      );
      const needsBackfill = !!backfillKey && !backfills.has(backfillKey);
      const waSince =
        !full && !needsBackfill && p.whatsappSince
          ? toCoreDataSeconds(p.whatsappSince) - DAY_S
          : 0;
      const imessages = chatDb
        ? readIMessages(
            chatDb,
            p.handles.flatMap((h) => byHandle.get(h) ?? []),
            imSince,
          )
        : [];
      const whatsapp = waDb
        ? readWhatsAppMessages(waDb, sessions, p.handles, waSince, identities)
        : [];

      if (dryRun) {
        console.log(
          summaryLine(p.name, imessages.length, whatsapp.length, null),
        );
        continue;
      }
      const added =
        (await send(p.id, "imessage", imessages)) +
        (await send(p.id, "whatsapp", whatsapp));
      console.log(
        summaryLine(p.name, imessages.length, whatsapp.length, added),
      );
      if (waDb && backfillKey && needsBackfill) {
        try {
          await markWhatsAppBackfill(backfillKey);
          backfills.add(backfillKey);
        } catch {
          console.warn(
            `${p.name}: messages saved; history checkpoint will retry next sync.`,
          );
        }
      }
      // Retry failed summaries even when the next import has no new messages.
      if (chatDb) {
        try {
          await api("/api/capture/dating/contacts", {
            method: "POST",
            body: JSON.stringify({
              personId: p.id,
              name: p.name,
              handles: p.handles,
              status: "messages_checked",
            }),
          });
        } catch {
          console.warn("Message check status could not save; it will retry.");
        }
      }
      try {
        const result = await api("/api/capture/dating/insights", {
          method: "POST",
          body: JSON.stringify({ personId: p.id }),
        });
        if (result.refreshed)
          console.log(`${p.name}: summary refreshed from saved messages.`);
      } catch {
        console.warn(
          `${p.name}: summary refresh failed; will retry next sync.`,
        );
      }
    }
  } catch (e) {
    if (e instanceof FullDiskAccessError) {
      console.error(fullDiskAccessHelp(e.path));
      process.exitCode = 2; // not process.exit(): `finally` must delete the snapshots
      return;
    }
    throw e;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function install() {
  const uid = userInfo().uid;
  const label = "com.personal-os.dating-messages-sync";
  const plistPath = join(homedir(), "Library/LaunchAgents", `${label}.plist`);
  const logPath = join(
    homedir(),
    "Library/Logs/personal-os/dating-messages-sync.log",
  );
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
