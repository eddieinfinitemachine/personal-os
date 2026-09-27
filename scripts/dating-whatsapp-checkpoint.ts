import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const WHATSAPP_BACKFILL_PATH = join(homedir(), "Library/Application Support/personal-os/dating-whatsapp-backfill.json");
const validKey = (key: unknown): key is string => typeof key === "string" && /^[a-f0-9]{64}$/.test(key);

/** Hash only the destination and exact evidence relevant to this saved person. */
export function whatsappBackfillKey(base: string, personId: string, handles: readonly string[], identities: ReadonlyMap<string, string>): string | null {
  const exactHandles = [...new Set(handles)].sort();
  const wanted = new Set(exactHandles);
  const matched = [...identities].filter(([lid, phone]) => /^\d{1,20}@lid$/.test(lid) && /^\+[1-9]\d{6,14}$/.test(phone) && wanted.has(phone))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (!matched.length) return null;
  return createHash("sha256").update(JSON.stringify({ version: 1, base, personId, handles: exactHandles, identities: matched })).digest("hex");
}

/** Missing/corrupt/unreadable state means retry a deduplicated full backfill. */
export function readWhatsAppBackfills(path = WHATSAPP_BACKFILL_PATH): Set<string> {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object") return new Set();
    const value = raw as { version?: unknown; keys?: unknown };
    if (value.version !== 1 || !Array.isArray(value.keys) || !value.keys.every(validKey)) return new Set();
    return new Set(value.keys);
  } catch {
    return new Set();
  }
}

/** Call only after every import batch succeeds. Never stores phones or names. */
export async function markWhatsAppBackfill(key: string, path = WHATSAPP_BACKFILL_PATH): Promise<void> {
  if (!validKey(key)) throw new Error("Invalid WhatsApp backfill key");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`;
  // Serialize read/merge/rename across overlapping jobs. A crashed writer's
  // leftover lock fails safely: history is retried, never silently skipped.
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      lock = await open(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!lock) throw new Error("WhatsApp backfill checkpoint is busy; retry later");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const keys = readWhatsAppBackfills(path);
    keys.add(key);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify({ version: 1, keys: [...keys].sort() }) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
