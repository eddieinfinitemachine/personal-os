// Sends finished research reports to EC Pad (scripts/research-worker.ts calls
// sendReadyReportsToPad once per poll). A report goes once: its report.md
// becomes a note in the Research project's "Claude Code" folder, its pictures
// go to "Claude Code/images/<reportId>/", and sent-to-pad.json in the report's
// working directory records that it went. Notes are never overwritten, because
// Eddie highlights and annotates them. Logs carry report ids only.
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { padNoteFileName, padNoteMarkdown, referencedImages } from "../../src/lib/research/pad";
import { OUTPUT_FILES } from "../../src/lib/research/prompt";
import { describeError, type Env } from "./headless-claude";

export const PAD_MARKER = "sent-to-pad.json";
/** How long a report whose send failed waits before the next attempt. */
export const PAD_RETRY_MS = 10 * 60_000;
export const MAX_IMAGE_SIDE = 2000;
const NOTES_FOLDER = "Claude Code";
const IMAGES_FOLDER = "images";
const SIPS = "/usr/bin/sips";

/** The EC Pad project the notes go to: RESEARCH_PAD_PROJECT_DIR, else Projects/Research in EC Pad's iCloud folder. */
export function padProjectDir(env: Env): string {
  return env.RESEARCH_PAD_PROJECT_DIR?.trim()
    || join(homedir(), "Library/Mobile Documents/iCloud~com~eddie~ecpad/Documents/Projects/Research");
}

type PadReportRow = { id: string; title: string; status: string; pdfUrl: string | null; pageCount: number | null; completedAt: Date | null };

/** The slice of Prisma the EC Pad step uses (mockable in tests). */
export type PadDb = {
  researchReport: {
    findMany(args: { where: { id: { in: string[] } }; select: Record<keyof PadReportRow, true> }): Promise<PadReportRow[]>;
  };
};

export type PadContext = {
  prisma: PadDb;
  /** The research working directories, one per report id. */
  root: string;
  padProjectDir: string;
  log: (line: string) => void;
  /** Caps a copied picture's long side at MAX_IMAGE_SIDE in place (capImageSize); throws when it can't. */
  resizeImage: (path: string) => Promise<void>;
};

/** Per worker process: whether the missing project was logged, and when failed sends may retry. */
const padState = new WeakMap<PadContext, { warnedMissing: boolean; retryAt: Map<string, number> }>();

function stateFor(ctx: PadContext) {
  let state = padState.get(ctx);
  if (!state) padState.set(ctx, (state = { warnedMissing: false, retryAt: new Map() }));
  return state;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** A PDF header and an end-of-file marker: rules out a file cut off mid-write by a kill. */
export async function isCompletePdf(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size < 1024) return false;
    const bytes = await readFile(path);
    return bytes.subarray(0, 5).toString("latin1") === "%PDF-" && bytes.subarray(-1024).toString("latin1").includes("%%EOF");
  } catch {
    return false;
  }
}

/** `sips -g pixelWidth -g pixelHeight` output → the size; null when it isn't there. */
export function parseSipsSize(stdout: string): { width: number; height: number } | null {
  const width = Number(/^\s+pixelWidth:\s*(\d+)\s*$/m.exec(stdout)?.[1]);
  const height = Number(/^\s+pixelHeight:\s*(\d+)\s*$/m.exec(stdout)?.[1]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Shrinks a picture in place with macOS sips when its long side is over `maxSide`. */
export async function capImageSize(path: string, maxSide = MAX_IMAGE_SIDE): Promise<void> {
  const run = promisify(execFile);
  const { stdout } = await run(SIPS, ["-g", "pixelWidth", "-g", "pixelHeight", path], { timeout: 60_000, encoding: "utf8" });
  const size = parseSipsSize(stdout);
  if (!size) throw new Error("sips printed no size");
  if (Math.max(size.width, size.height) > maxSide) await run(SIPS, ["-Z", String(maxSide), path], { timeout: 60_000 });
}

/** Working directories with report.md and a complete PDF that haven't gone to EC Pad yet. */
async function unsentReports(root: string, skip: (id: string) => boolean): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const name of names.sort()) {
    if (name.startsWith(".") || skip(name)) continue;
    const dir = join(root, name);
    if (await exists(join(dir, PAD_MARKER))) continue;
    if (!(await isFile(join(dir, OUTPUT_FILES.markdown)))) continue;
    if (await isCompletePdf(join(dir, OUTPUT_FILES.pdf))) ids.push(name);
  }
  return ids;
}

/** "<base>.md", else "<base> 2.md", " 3"…: the first name with no note (or iCloud placeholder) behind it. */
async function freeNoteName(notesDir: string, base: string): Promise<string> {
  for (let n = 1; n <= 1000; n++) {
    const name = n === 1 ? `${base}.md` : `${base} ${n}.md`;
    if (!(await exists(join(notesDir, name))) && !(await exists(join(notesDir, `.${name}.icloud`)))) return name;
  }
  throw new Error("no free note name");
}

async function writeMarker(workDir: string, value: Record<string, string>) {
  await writeFile(join(workDir, PAD_MARKER), `${JSON.stringify(value, null, 2)}\n`);
}

async function sendReport(ctx: PadContext, row: PadReportRow, now: number) {
  const workDir = join(ctx.root, row.id);
  const markdown = await readFile(join(workDir, OUTPUT_FILES.markdown), "utf8");
  const notesDir = join(ctx.padProjectDir, NOTES_FOLDER);
  await mkdir(notesDir, { recursive: true });

  let missing = 0;
  for (const file of referencedImages(markdown)) {
    const source = join(workDir, IMAGES_FOLDER, file);
    if (!(await isFile(source))) {
      missing++;
      continue;
    }
    const imagesDir = join(notesDir, IMAGES_FOLDER, row.id);
    await mkdir(imagesDir, { recursive: true });
    const dest = join(imagesDir, file);
    await copyFile(source, dest);
    try {
      await ctx.resizeImage(dest);
    } catch (error) {
      ctx.log(`Research ${row.id}: picture kept full size, resize failed (${describeError(error)})`);
    }
  }
  if (missing) ctx.log(`Research ${row.id}: ${missing} referenced picture(s) missing`);

  const note = padNoteMarkdown(markdown, {
    title: row.title, reportId: row.id, pdfUrl: row.pdfUrl, pageCount: row.pageCount, date: row.completedAt ?? new Date(now),
  });
  const name = await freeNoteName(notesDir, padNoteFileName(row.title));
  // EC Pad ignores dot files, so a half-written note never shows up.
  const temp = join(notesDir, `.research-${row.id}-${now}.md.tmp`);
  try {
    await writeFile(temp, note);
    await rename(temp, join(notesDir, name));
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  await writeMarker(workDir, { note: relative(ctx.padProjectDir, join(notesDir, name)), at: new Date(now).toISOString() });
  ctx.log(`Research ${row.id}: sent to EC Pad`);
}

async function sendReady(ctx: PadContext, now: number) {
  const state = stateFor(ctx);
  const project = ctx.padProjectDir;
  if (!(await exists(join(project, "project.md"))) && !(await exists(join(project, ".project.md.icloud")))) {
    if (!state.warnedMissing) ctx.log("Research worker: EC Pad Research project not found; finished reports wait until it exists");
    state.warnedMissing = true;
    return;
  }
  const ids = await unsentReports(ctx.root, (id) => (state.retryAt.get(id) ?? 0) > now);
  if (!ids.length) return;
  const rows = await ctx.prisma.researchReport.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, status: true, pdfUrl: true, pageCount: true, completedAt: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    try {
      if (!row) {
        // Deleted in the app: stop checking it.
        await writeMarker(join(ctx.root, id), { skipped: "report deleted", at: new Date(now).toISOString() });
        ctx.log(`Research ${id}: deleted; not sent to EC Pad`);
      } else if (row.status === "ready") {
        await sendReport(ctx, row, now);
        state.retryAt.delete(id);
      }
      // Any other status: checked again on the next poll.
    } catch (error) {
      state.retryAt.set(id, now + PAD_RETRY_MS);
      ctx.log(`Research ${id}: EC Pad send failed (${describeError(error)})`);
    }
  }
}

/**
 * Writes every ready report that has a report.md and hasn't gone yet into the
 * EC Pad Research project. Never throws: the worker's poll loop calls it.
 */
export async function sendReadyReportsToPad(ctx: PadContext, now = Date.now()): Promise<void> {
  try {
    await sendReady(ctx, now);
  } catch (error) {
    ctx.log(`Research worker: EC Pad check failed (${describeError(error)})`);
  }
}
