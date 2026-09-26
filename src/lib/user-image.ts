import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { del, put } from "@vercel/blob";
import sharp from "sharp";
import heicConvert from "heic-convert";
import { deleteFile, saveFile } from "@/lib/storage";
import { sniffImage } from "@/lib/board-sniff";

// Re-hosted user images (mood board, dating photos). Blob keys live under
// users/<userId>/<folder>/, e.g. folder "board" or "dating/<personId>". Without
// a Blob token (local dev) files land in public/uploads/<head>/<userId>/<rest>,
// which keeps the board's existing /uploads/board/<userId>/ paths.

// Uploads: Vercel rejects function request bodies over 4.5 MB before the
// route runs, so anything larger never reaches us anyway.
export const MAX_UPLOAD_BYTES = Math.floor(4.4 * 1024 * 1024);
const MAX_EDGE = 1600;

export type StoredImage = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  color: string | null;
};

const SEGMENT = /^[A-Za-z0-9_-]+$/;

function checkFolder(folder: string): string[] {
  const parts = folder.split("/");
  if (!parts.length || !parts.every((p) => SEGMENT.test(p))) throw new Error(`bad image folder: ${folder}`);
  return parts;
}

/** Local-dev scope under public/uploads for a user's folder. */
function localScope(userId: string, folder: string): string {
  const [head, ...rest] = checkFolder(folder);
  return [head, userId, ...rest].join("/");
}

/**
 * True when `url` is an image this app stored for `userId` under `folder`:
 * a Vercel Blob URL under /users/<userId>/<folder>/ or a local-dev
 * /uploads path for the same. Anything else (someone else's blob, a remote
 * URL, a path with `..`) is false, so it is never deleted or fetched.
 */
export function ownsUserImage(userId: string, folder: string, url: string | null | undefined): boolean {
  if (!url || !userId || !SEGMENT.test(userId) || url.includes("..") || url.includes("\\")) return false;
  let scope: string;
  try {
    scope = localScope(userId, folder);
  } catch {
    return false;
  }
  if (url.startsWith("/")) return url.startsWith(`/uploads/${scope}/`);
  if (!/^https:\/\/[^/]+\.blob\.vercel-storage\.com\//.test(url)) return false;
  try {
    return new URL(url).pathname.startsWith(`/users/${userId}/${folder}/`);
  } catch {
    return false;
  }
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

// Normalize (EXIF-rotate, cap at 1600px, WebP, keep GIF animation) and upload.
// iPhone HEIC goes through heic-convert first (the bundled libvips has no
// HEVC decoder). Returns null when the bytes aren't a decodable image.
export async function storeUserImage(userId: string, folder: string, raw: Buffer): Promise<StoredImage | null> {
  const scope = localScope(userId, folder);
  let input = raw;
  if (sniffImage(raw) === "heic") {
    try {
      input = Buffer.from(await heicConvert({ buffer: raw, format: "JPEG", quality: 0.9 }));
    } catch (e) {
      console.warn("[image] heic decode failed", { folder, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }
  let out: Buffer;
  let width: number;
  let height: number;
  let color: string | null = null;
  try {
    const src = sharp(input, { animated: true, limitInputPixels: 100_000_000 });
    out = await src
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const m = await sharp(out).metadata();
    width = m.width ?? 0;
    height = m.pageHeight ?? m.height ?? 0;
    if (!width || !height) return null;
    const { dominant } = await sharp(out).stats();
    color = `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
  } catch (e) {
    console.warn("[image] decode failed", { folder, error: e instanceof Error ? e.message : String(e) });
    return null;
  }

  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.webp`;
  let imageUrl: string;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`users/${userId}/${folder}/${name}`, out, {
      access: "public",
      addRandomSuffix: false,
      contentType: "image/webp",
    });
    imageUrl = blob.url;
  } else {
    imageUrl = await saveFile(scope, name, out);
  }
  return { imageUrl, imageWidth: width, imageHeight: height, color };
}

// Only deletes images this user's uploads stored under `folder`; anything
// else (a remote URL, another user's blob) is left alone.
export async function deleteUserImage(userId: string, folder: string, url: string | null): Promise<void> {
  if (!url || !ownsUserImage(userId, folder, url)) return;
  try {
    if (url.startsWith("/uploads/")) await deleteFile(url);
    else await del(url);
  } catch (e) {
    console.error("[image] delete failed (orphaned)", url, e);
  }
}

/** Bytes of an image this user owns (never fetches anything else). */
export async function readUserImage(
  userId: string,
  folder: string,
  url: string,
  timeoutMs = 10_000,
): Promise<Buffer | null> {
  if (!ownsUserImage(userId, folder, url)) return null;
  try {
    if (url.startsWith("/uploads/")) return await readFile(join(process.cwd(), "public", url));
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.warn("[image] read failed", url, e instanceof Error ? e.message : String(e));
    return null;
  }
}
