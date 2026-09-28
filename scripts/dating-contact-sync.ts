import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  readFreshDatingContacts,
  type DatingContactsCache,
} from "./dating-contact-cache";
import { findDatingContactChoices } from "../src/lib/dating-contact-match";

type Person = { id: string; name: string };
export type ContactAPI = (path: string, body?: object) => Promise<any>;
/** Resolve only already-added profiles. No directory or unrelated conversations leave the Mac. */
export async function resolveAddedContacts(options: {
  api: ContactAPI;
  load?: (opts?: { force?: boolean }) => Promise<DatingContactsCache>;
  personId?: string;
}) {
  const response = await options.api("/api/capture/dating/contacts");
  const people: Person[] = response.people.filter(
    (p: Person) => !options.personId || p.id === options.personId,
  );
  const resolved: string[] = (response.messageRetries ?? [])
    .filter((p: Person) => !options.personId || p.id === options.personId)
    .map((p: Person) => p.id);
  if (!people.length) return resolved;
  const cache = await (options.load ?? readFreshDatingContacts)({
    force: response.refreshContacts === true,
  });
  for (const person of people) {
    try {
      if (cache.status !== "ready") {
        await options.api("/api/capture/dating/contacts", {
          personId: person.id,
          name: person.name,
          status: "unavailable",
        });
        continue;
      }
      const match = findDatingContactChoices(person.name, cache.contacts);
      if (match.status === "matched") {
        const result = await options.api("/api/capture/dating/contacts", {
          personId: person.id,
          name: person.name,
          handles: [...match.contact.phones, ...match.contact.emails],
        });
        if (result.resolved) resolved.push(person.id);
        else if (
          result.reason === "shared_contact" ||
          result.reason === "ambiguous_name"
        )
          await options.api("/api/capture/dating/contacts", {
            personId: person.id,
            name: person.name,
            status: "ambiguous",
            candidates: [match.contact],
          });
      } else {
        await options.api("/api/capture/dating/contacts", {
          personId: person.id,
          name: person.name,
          status: match.status.replaceAll("-", "_"),
          candidates: match.candidates,
        });
      }
    } catch {
      console.warn("A contact lookup could not finish; it will retry.");
    }
  }
  return resolved;
}

type Target = Person & { handles: string[] };
export type ContactCheckpoint = { version: 1; people: Record<string, string> };
const fingerprint = (p: Target) =>
  createHash("sha256")
    .update(JSON.stringify([...p.handles].sort()))
    .digest("hex");
/** New/changed handles include explicit UI choices, not only this run's automatic matches. */
export async function syncNewContactThreads(options: {
  targets: Target[];
  resolved: string[];
  checkpoint: ContactCheckpoint | null;
  sync: (personId: string) => Promise<void>;
  checked: (person: Target) => Promise<void>;
  failed?: (person: Target) => Promise<void>;
  save: (checkpoint: ContactCheckpoint) => Promise<void>;
  maxPeople?: number;
}) {
  const checkpoint: ContactCheckpoint = options.checkpoint ?? {
    version: 1,
    people: Object.fromEntries(
      options.targets
        .filter((p) => !options.resolved.includes(p.id))
        .map((p) => [p.id, fingerprint(p)]),
    ),
  };
  const present = new Set(options.targets.map((p) => p.id));
  for (const id of Object.keys(checkpoint.people))
    if (!present.has(id)) delete checkpoint.people[id];
  // Explicit Retry consumes the prior success before attempting, so failure remains retryable.
  for (const id of options.resolved) delete checkpoint.people[id];
  // Save the initial baseline before importing: old profiles keep their existing scheduled import.
  await options.save(checkpoint);
  let attempted = 0;
  for (const person of options.targets) {
    if (checkpoint.people[person.id] === fingerprint(person)) continue;
    if (attempted++ >= (options.maxPeople ?? 2)) break;
    try {
      await options.sync(person.id);
      await options.checked(person);
      checkpoint.people[person.id] = fingerprint(person);
      await options.save(checkpoint);
    } catch {
      try {
        await options.failed?.(person);
      } catch {}
      console.warn("Matching message import could not finish; it will retry.");
    }
  }
  return checkpoint;
}

export async function runContactWorker() {
  try {
    process.loadEnvFile(".env");
  } catch {}
  const base = process.env.DATING_SYNC_URL ?? process.env.APP_URL ?? "";
  const token = process.env.CAPTURE_TOKEN ?? "";
  const origin = new URL(base);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    !token
  )
    throw Error("Contact sync needs its configured Personal OS connection");
  const api: ContactAPI = async (path, body) => {
    const response = await fetch(new URL(path, origin), {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Error(`Contact sync request failed (${response.status})`);
    return response.json();
  };
  const resolved = await resolveAddedContacts({ api });
  const targets = (await api("/api/capture/dating")).people as Target[];
  const root = join(homedir(), "Library/Application Support/personal-os");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const key = createHash("sha256")
    .update(origin.origin + ":" + token)
    .digest("hex");
  const path = join(root, `dating-contact-sync-${key}.json`);
  let checkpoint: ContactCheckpoint | null = null;
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (data.version === 1 && data.people && typeof data.people === "object")
      checkpoint = data;
  } catch {}
  const require = createRequire(import.meta.url);
  await syncNewContactThreads({
    targets,
    resolved,
    checkpoint,
    sync: async (personId) => {
      await promisify(execFile)(
        process.execPath,
        [
          require.resolve("tsx/cli"),
          join(
            dirname(fileURLToPath(import.meta.url)),
            "dating-messages-sync.ts",
          ),
          `--person-id=${personId}`,
          "--require-imessage",
        ],
        { timeout: 150000, maxBuffer: 2 * 1024 * 1024 },
      );
    },
    checked: async (person) => {
      await api("/api/capture/dating/contacts", {
        personId: person.id,
        name: person.name,
        handles: person.handles,
        status: "messages_checked",
      });
    },
    failed: async (person) => {
      await api("/api/capture/dating/contacts", {
        personId: person.id,
        name: person.name,
        handles: person.handles,
        status: "messages_unavailable",
      });
    },
    save: async (data) => {
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
      await rename(temp, path);
    },
  });
  console.log(
    `Automatic contact lookup complete (${resolved.length} resolved).`,
  );
}
export async function installContactWorker() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const label = "com.personal-os.dating-contact-sync";
  const plist = join(homedir(), "Library/LaunchAgents", `${label}.plist`);
  const log = join(
    homedir(),
    "Library/Logs/personal-os/dating-contact-sync.log",
  );
  const xml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const require = createRequire(import.meta.url);
  await mkdir(dirname(plist), { recursive: true });
  await mkdir(dirname(log), { recursive: true, mode: 0o700 });
  await writeFile(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(require.resolve("tsx/cli"))}</string><string>${xml(join(root, "scripts/dating-contact-sync.ts"))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>StartInterval</key><integer>60</integer><key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>`,
    { mode: 0o600 },
  );
  const domain = `gui/${process.getuid!()}`;
  try {
    await promisify(execFile)("/bin/launchctl", [
      "bootout",
      `${domain}/${label}`,
    ]);
  } catch {}
  await promisify(execFile)("/bin/launchctl", ["bootstrap", domain, plist]);
  console.log(
    "Installed automatic contact lookup. Checks every minute while your Mac is awake.",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  (process.argv.includes("--install-launchd")
    ? installContactWorker()
    : runContactWorker()
  ).catch(() => {
    console.error(
      "Automatic contact lookup could not finish; check Mac access and source status.",
    );
    process.exitCode = 1;
  });
}
