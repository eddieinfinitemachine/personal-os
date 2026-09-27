// Reads the existing on-device cache only. No Contacts launch, export, OS
// permission changes, database writes, network calls, or bulk contact upload.
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatingContact } from "../src/lib/dating-contact-match";

export const DATING_CONTACTS_CACHE = join(homedir(), "Library/Application Support/personal-os/contacts.json");
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
  const strings = (v: unknown) => Array.isArray(v) && v.every((item) => typeof item === "string");
  if (typeof c.name !== "string" || !strings(c.phones) || !strings(c.emails)) return false;
  if (["first", "last", "nick", "org"].some((key) => c[key] !== undefined && typeof c[key] !== "string")) return false;
  if (c.instagram != null && typeof c.instagram !== "string") return false;
  if (c.socialUrls != null) {
    if (typeof c.socialUrls !== "object" || Array.isArray(c.socialUrls)) return false;
    const instagram = (c.socialUrls as Record<string, unknown>).instagram;
    if (instagram != null && typeof instagram !== "string") return false;
  }
  return true;
}

/** Freshness matches link-contacts.ts's 24-hour export cache policy. */
export async function readDatingContactsCache(opts: { path?: string; maxAgeMs?: number; now?: number } = {}): Promise<DatingContactsCache> {
  const path = opts.path ?? DATING_CONTACTS_CACHE;
  let updatedAt: string | null = null;
  let ageMs: number | null = null;
  try {
    const info = await stat(path);
    if (!info.isFile()) return { status: "unreadable", contacts: [], updatedAt, ageMs };
    updatedAt = info.mtime.toISOString();
    ageMs = Math.max(0, (opts.now ?? Date.now()) - info.mtimeMs);
    if (info.size > 20 * 1024 * 1024) return { status: "invalid", contacts: [], updatedAt, ageMs };
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    // Never silently drop a malformed row: it could be the other same-name
    // identity whose exclusion would make an ambiguous name look unique.
    if (!Array.isArray(raw) || !raw.every(validContact)) return { status: "invalid", contacts: [], updatedAt, ageMs };
    return { status: ageMs > (opts.maxAgeMs ?? CONTACTS_CACHE_MAX_AGE_MS) ? "stale" : "ready", contacts: raw, updatedAt, ageMs };
  } catch (error) {
    const status = error instanceof SyntaxError ? "invalid" : (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
    return { status, contacts: [], updatedAt, ageMs };
  }
}
