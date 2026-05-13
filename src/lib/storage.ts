import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PUBLIC_DIR = join(process.cwd(), "public");
const UPLOADS_PREFIX = "/uploads";

// Filesystem-backed storage for local dev. Files land under public/uploads/...
// so Next serves them directly. When deploying to Vercel, swap the body of
// these two functions to use @vercel/blob — keep the (scope, filename) signature.
export async function saveFile(
  scope: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const dir = join(PUBLIC_DIR, "uploads", scope);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), buffer);
  return `${UPLOADS_PREFIX}/${scope}/${filename}`;
}

export async function deleteFile(url: string): Promise<void> {
  if (!url.startsWith(`${UPLOADS_PREFIX}/`)) return;
  const path = join(PUBLIC_DIR, url);
  try {
    await unlink(path);
  } catch {
    // Already gone — fine.
  }
}

export function safeFilename(original: string): string {
  const ext = original.split(".").pop()?.toLowerCase() ?? "bin";
  const safe = ext.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${safe}`;
}
