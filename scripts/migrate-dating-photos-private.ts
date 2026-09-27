/**
 * No writes by default: pnpm exec tsx scripts/migrate-dating-photos-private.ts
 * Apply: add --apply --manifest-dir /absolute/private/dating-photo-migration
 * Requires an explicitly selected DATABASE_URL, DATING_READ_WRITE_TOKEN,
 * and the legacy BLOB_READ_WRITE_TOKEN when deleting old public blobs.
 * Resume with the same manifest directory. Never delete it before completion.
 * A crash may leave a .lock: confirm the old process exited before removing it.
 */
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { get, put } from "@vercel/blob";
import { datingPhotoFolder } from "../src/lib/dating-photos";
import { deleteUserImageStrict, isPrivateUserImage, ownsUserImage, readUserImage } from "../src/lib/user-image";
import { migrateDatingPhoto, photoDigest, type PhotoMigrationEntry } from "../src/lib/dating-photo-migration";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Dry run by default. Apply with --apply --manifest-dir /absolute/private/directory. Select DATABASE_URL and both Blob tokens explicitly; no .env file is loaded by this script.");
    return;
  }
  const apply = args.includes("--apply");
  const dirIndex = args.indexOf("--manifest-dir");
  const dir = dirIndex >= 0 ? args[dirIndex + 1] : undefined;
  const allowed = args.filter((_, i) => i !== dirIndex + 1 || dirIndex < 0);
  if (allowed.some((a) => a !== "--apply" && a !== "--manifest-dir")) throw new Error("Unknown argument");
  if (!process.env.DATABASE_URL) throw new Error("Select DATABASE_URL explicitly");
  const token = process.env.DATING_READ_WRITE_TOKEN;
  if (apply && (!token || !dir || !isAbsolute(dir))) throw new Error("Apply requires private Blob token and absolute --manifest-dir");
  const db = new PrismaClient();
  let locked = false;
  try {
    const photos = await db.datingPhoto.findMany({ select: { id: true, userId: true, personId: true, url: true } });
    const legacy = photos.filter((p) => !isPrivateUserImage(p.url));
    console.log(`${legacy.length} legacy photos; ${photos.length - legacy.length} already private. ${apply ? "Applying" : "Dry run: no writes"}.`);
    if (!apply) return;
    if (legacy.some((p) => p.url.startsWith("https:")) && !process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error("Legacy public Blob token is required for cleanup");
    }
    await mkdir(dir!, { recursive: true, mode: 0o700 });
    const ds = await lstat(dir!);
    if (!ds.isDirectory() || (ds.mode & 0o077)) throw new Error("Manifest directory must be a real directory with mode 0700");
    const lock = await open(join(dir!, ".lock"), "wx", 0o600);
    locked = true;
    await lock.writeFile(String(process.pid));
    await lock.close();
    const path = join(dir!, "manifest.json");
    let entries: Record<string, PhotoMigrationEntry> = {};
    try {
      const fs = await lstat(path);
      if (!fs.isFile() || (fs.mode & 0o077)) throw new Error("Manifest must be a real file with mode 0600");
      const parsed = JSON.parse(await readFile(path, "utf8")) as { version: number; entries: Record<string, PhotoMigrationEntry> };
      if (parsed.version !== 1 || !parsed.entries || Array.isArray(parsed.entries)) throw new Error("Invalid migration manifest");
      entries = parsed.entries;
      for (const [id, e] of Object.entries(entries)) {
        if (id !== e.id || !/^[a-f0-9]{64}$/.test(e.sha256) || !["copied", "switched", "complete"].includes(e.stage) ||
          !ownsUserImage(e.userId, datingPhotoFolder(e.personId), e.sourceUrl) ||
          !ownsUserImage(e.userId, datingPhotoFolder(e.personId), e.targetUrl) ||
          !e.targetUrl.startsWith("https:") || !isPrivateUserImage(e.targetUrl) || isPrivateUserImage(e.sourceUrl)) {
          throw new Error("Invalid migration manifest entry");
        }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const save = async (e: PhotoMigrationEntry) => {
      entries[e.id] = e;
      const temp = `${path}.${process.pid}.tmp`;
      const file = await open(temp, "w", 0o600);
      try {
        await chmod(temp, 0o600);
        await file.writeFile(JSON.stringify({ version: 1, entries }, null, 2));
        await file.sync();
      } finally { await file.close(); }
      await rename(temp, path);
    };
    // Resume unfinished entries even after their database URL was switched.
    const pending = new Map(legacy.map((p) => [p.id, p]));
    for (const e of Object.values(entries)) {
      if (e.stage !== "complete") pending.set(e.id, { id: e.id, userId: e.userId, personId: e.personId, url: e.sourceUrl });
    }
    for (const photo of pending.values()) {
      const folder = datingPhotoFolder(photo.personId);
      if (!ownsUserImage(photo.userId, folder, photo.url)) throw new Error("Unrecognized source photo; preserved");
      if (photo.url.startsWith("https:") && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Legacy public Blob token is required for cleanup");
      await migrateDatingPhoto(photo, entries[photo.id], {
        readSource: (p) => readUserImage(p.userId, datingPhotoFolder(p.personId), p.url),
        copyPrivate: async (p, bytes) => {
          // Deterministic name recovers a copy completed before its journal write.
          const name = `users/${p.userId}/${datingPhotoFolder(p.personId)}/migrated-${p.id}.webp`;
          const existing = await get(name, { access: "private", token, useCache: false });
          if (existing?.statusCode === 200) {
            const raw = Buffer.from(await new Response(existing.stream).arrayBuffer());
            if (photoDigest(raw) !== photoDigest(bytes)) throw new Error("Existing private copy differs; source preserved");
            return existing.blob.url;
          }
          return (await put(name, bytes, { access: "private", token, contentType: "image/webp", addRandomSuffix: false })).url;
        },
        readTarget: async (p, url) => {
          if (!ownsUserImage(p.userId, datingPhotoFolder(p.personId), url) || !isPrivateUserImage(url)) return null;
          const result = await get(url, { access: "private", token, useCache: false });
          return result?.statusCode === 200 ? Buffer.from(await new Response(result.stream).arrayBuffer()) : null;
        },
        currentUrl: async (id) => (await db.datingPhoto.findUnique({ where: { id } }))?.url ?? null,
        switchUrl: async (p, url) => (await db.datingPhoto.updateMany({ where: { id: p.id, userId: p.userId, personId: p.personId, url: p.url }, data: { url } })).count === 1,
        deleteSource: (p) => deleteUserImageStrict(p.userId, datingPhotoFolder(p.personId), p.url),
        save,
      });
      console.log(`Completed photo ${photo.id}`);
    }
  } finally {
    await db.$disconnect();
    if (locked) await unlink(join(dir!, ".lock"));
  }
}

main().catch((error: unknown) => {
  // Do not log SDK error objects, request headers, or tokens.
  console.error("Photo migration stopped. Preserve the manifest and rerun after resolving the error.");
  console.error(error instanceof Error ? error.message.replace(/vercel_blob_[^\s]+/g, "[redacted]") : "Unknown error");
  process.exitCode = 1;
});
