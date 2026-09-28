// Contact directory stays on-device. The read-only reader supports diagnostics;
// automatic lookup refreshes expired data through the existing Contacts API.
import { readFile, stat } from "node:fs/promises";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatingContact } from "../src/lib/dating-contact-match";

export const DATING_CONTACTS_CACHE = join(
  homedir(),
  "Library/Application Support/personal-os/contacts.json",
);
export const CONTACTS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export type DatingContactsCache = {
  status: "ready" | "stale" | "missing" | "invalid" | "unreadable";
  /** Stale records are returned for explicit caller policy, never represented as fresh. */
  contacts: DatingContact[];
  updatedAt: string | null;
  ageMs: number | null;
};
function validContact(value: unknown): value is DatingContact {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  const strings = (v: unknown) =>
    Array.isArray(v) && v.every((item) => typeof item === "string");
  if (typeof c.name !== "string" || !strings(c.phones) || !strings(c.emails))
    return false;
  if (
    ["first", "last", "nick", "org"].some(
      (key) => c[key] !== undefined && typeof c[key] !== "string",
    )
  )
    return false;
  if (c.instagram != null && typeof c.instagram !== "string") return false;
  if (c.socialUrls != null) {
    if (typeof c.socialUrls !== "object" || Array.isArray(c.socialUrls))
      return false;
    const instagram = (c.socialUrls as Record<string, unknown>).instagram;
    if (instagram != null && typeof instagram !== "string") return false;
  }
  return true;
}

/** Freshness matches link-contacts.ts's 24-hour export cache policy. */
export async function readDatingContactsCache(
  opts: { path?: string; maxAgeMs?: number; now?: number } = {},
): Promise<DatingContactsCache> {
  const path = opts.path ?? DATING_CONTACTS_CACHE;
  let updatedAt: string | null = null;
  let ageMs: number | null = null;
  try {
    const info = await stat(path);
    if (!info.isFile())
      return { status: "unreadable", contacts: [], updatedAt, ageMs };
    updatedAt = info.mtime.toISOString();
    ageMs = Math.max(0, (opts.now ?? Date.now()) - info.mtimeMs);
    if (info.size > 20 * 1024 * 1024)
      return { status: "invalid", contacts: [], updatedAt, ageMs };
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    // Never silently drop a malformed row: it could be the other same-name
    // identity whose exclusion would make an ambiguous name look unique.
    if (!Array.isArray(raw) || !raw.every(validContact))
      return { status: "invalid", contacts: [], updatedAt, ageMs };
    return {
      status:
        ageMs > (opts.maxAgeMs ?? CONTACTS_CACHE_MAX_AGE_MS)
          ? "stale"
          : "ready",
      contacts: raw,
      updatedAt,
      ageMs,
    };
  } catch (error) {
    const status =
      error instanceof SyntaxError
        ? "invalid"
        : (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "missing"
          : "unreadable";
    return { status, contacts: [], updatedAt, ageMs };
  }
}

/** Current Contacts data stays on-device. Never silently resolve from an expired directory. */
export async function readFreshDatingContacts(
  opts: {
    path?: string;
    now?: number;
    force?: boolean;
    exportContacts?: () => Promise<unknown>;
  } = {},
): Promise<DatingContactsCache> {
  const path = opts.path ?? DATING_CONTACTS_CACHE;
  const cached = await readDatingContactsCache({ path, now: opts.now });
  if (cached.status === "ready" && !opts.force) return cached;
  try {
    const raw = opts.exportContacts
      ? await opts.exportContacts()
      : JSON.parse(
          (
            await promisify(execFile)(
              "/usr/bin/osascript",
              [
                "-l",
                "JavaScript",
                "-e",
                `
const people = Application("Contacts").people;
const names=people.name(), firsts=people.firstName(), lasts=people.lastName();
const nicks=people.nickname(), orgs=people.organization();
const phones=people.phones.value(), emails=people.emails.value();
JSON.stringify(names.map((name,i)=>({name:name||"",first:firsts[i]||"",last:lasts[i]||"",nick:nicks[i]||"",org:orgs[i]||"",phones:phones[i]||[],emails:emails[i]||[]})));`,
              ],
              { timeout: 90000, maxBuffer: 20 * 1024 * 1024, encoding: "utf8" },
            )
          ).stdout,
        );
    if (!Array.isArray(raw) || !raw.every(validContact))
      throw Error("Invalid Contacts export");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(raw), { mode: 0o600 });
    await rename(temp, path);
    return {
      status: "ready",
      contacts: raw,
      updatedAt: new Date(opts.now ?? Date.now()).toISOString(),
      ageMs: 0,
    };
  } catch {
    return { ...cached, status: "unreadable", contacts: [] };
  }
}
