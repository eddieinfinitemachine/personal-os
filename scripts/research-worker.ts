/**
 * Research worker: turns queued /research topics into illustrated PDF reports.
 * Claims the oldest queued report, runs Claude Code headless with the
 * deep-research skill in ~/Library/Application Support/personal-os/research/<id>/,
 * uploads report.pdf to Vercel Blob and marks the row ready (or failed).
 * Polls every 30 s; SIGTERM stops it cleanly and puts a running job back in the queue.
 *
 *   pnpm exec tsx scripts/research-worker.ts [--once]
 *
 * --once processes at most one job, then exits. Needs DATABASE_URL and
 * BLOB_READ_WRITE_TOKEN (read from .env in the working directory). Only claims
 * reports belonging to RESEARCH_ALLOWED_EMAILS (comma-separated; defaults to
 * FOUNDER_EMAIL), because Claude runs here with every permission.
 * Logs report ids, statuses and costs only, never topics.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient, type ResearchReport } from "@prisma/client";
import { put, del } from "@vercel/blob";
import { claimNextReport, failStaleReports, requeueReport } from "../src/lib/research/claim";
import { OUTPUT_FILES, buildResearchPrompt, claudeArgs } from "../src/lib/research/prompt";
import {
  cleanSummary, cleanTitle, parseClaudeResult, parsePdfPageCount, parseSources, researchBlobKey, tailText,
} from "../src/lib/research/outputs";

export const POLL_MS = 30_000;
export const DEFAULT_TIMEOUT_MIN = 45;
const KILL_GRACE_MS = 10_000;
const MAX_CAPTURE_CHARS = 1_000_000;
const WORK_DIR_RETENTION_MS = 30 * 86_400_000;

export type WorkerFlags = { once: boolean };
type Env = Record<string, string | undefined>;

export function parseWorkerFlags(argv: string[]): WorkerFlags {
  const flags: WorkerFlags = { once: false };
  for (const arg of argv) {
    if (arg === "--once") flags.once = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return flags;
}

export function allowedEmails(env: Env): string[] {
  const raw = env.RESEARCH_ALLOWED_EMAILS ?? env.FOUNDER_EMAIL ?? "emcohen@me.com";
  return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function timeoutMs(env: Env): number {
  const minutes = Number(env.RESEARCH_TIMEOUT_MIN);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TIMEOUT_MIN) * 60_000;
}

const researchRoot = () => join(homedir(), "Library/Application Support/personal-os/research");

function claudeBin(env: Env): string {
  if (env.RESEARCH_CLAUDE_BIN) return env.RESEARCH_CLAUDE_BIN;
  const local = join(homedir(), ".local/bin/claude");
  return existsSync(local) ? local : "claude";
}

/** The deep-research SKILL.md under ~/.claude/skills (synced skills live in a UUID folder). */
async function findDeepResearchSkill(): Promise<string | null> {
  const root = join(homedir(), ".claude/skills");
  try {
    const entries = await readdir(root, { recursive: true });
    const match = entries.map(String).find((p) => p.endsWith("deep-research/SKILL.md"));
    return match ? join(root, match) : null;
  } catch {
    return null;
  }
}

/**
 * Environment for the Claude child: launchd's minimal env plus the usual tool
 * paths. Built before .env is loaded, so the production DATABASE_URL and the
 * Blob token never reach a process running with every permission.
 */
function childEnv(base: Env): Env {
  const extra = [join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const path = [...new Set([...extra, ...(base.PATH ?? "").split(":").filter(Boolean)])].join(":");
  return { ...base, PATH: path };
}

type RunResult = { code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; stopped: boolean; stdout: string; stderr: string };

const capture = (text: string, chunk: Buffer) => (text + chunk.toString("utf8")).slice(-MAX_CAPTURE_CHARS);

function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    // detached: the child leads its own process group, so subagents die with it.
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

function runClaude(options: { bin: string; args: string[]; cwd: string; env: Env; timeoutMs: number; registerStop: (stop: () => void) => void }): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(options.bin, options.args, { cwd: options.cwd, env: options.env as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const result: RunResult = { code: null, signal: null, timedOut: false, stopped: false, stdout: "", stderr: "" };
    child.stdout.on("data", (chunk: Buffer) => { result.stdout = capture(result.stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { result.stderr = capture(result.stderr, chunk); });
    let graceTimer: NodeJS.Timeout | null = null;
    const terminate = () => {
      killGroup(child, "SIGTERM");
      graceTimer ??= setTimeout(() => killGroup(child, "SIGKILL"), KILL_GRACE_MS);
    };
    const timer = setTimeout(() => { result.timedOut = true; terminate(); }, options.timeoutMs);
    options.registerStop(() => { result.stopped = true; terminate(); });
    child.on("error", (error) => { result.stderr += `\n${error.message}`; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      result.code = code;
      result.signal = signal;
      resolvePromise(result);
    });
  });
}

async function readOptional(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); } catch { return null; }
}

async function pdfPageCount(path: string): Promise<number | null> {
  for (const bin of ["/opt/homebrew/bin/pdfinfo", "/usr/local/bin/pdfinfo", "pdfinfo"]) {
    try {
      const { stdout } = await promisify(execFile)(bin, [path], { timeout: 30_000, encoding: "utf8" });
      return parsePdfPageCount(stdout);
    } catch {
      // Try the next location; null when pdfinfo isn't installed.
    }
  }
  return null;
}

async function isPdf(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size < 1024) return false;
    const head = (await readFile(path)).subarray(0, 5).toString("latin1");
    return head === "%PDF-";
  } catch {
    return false;
  }
}

/** Removes report working directories untouched for 30 days (images add up). */
async function sweepOldWorkDirs(root: string, now = Date.now()) {
  let names: string[] = [];
  try { names = await readdir(root); } catch { return; }
  for (const name of names) {
    const dir = join(root, name);
    try {
      const info = await stat(dir);
      if (info.isDirectory() && now - info.mtimeMs > WORK_DIR_RETENTION_MS) await rm(dir, { recursive: true, force: true });
    } catch {
      // Skip what we can't read.
    }
  }
}

export type Context = {
  prisma: PrismaClient;
  blobToken: string;
  bin: string;
  env: Env;
  timeoutMs: number;
  skillPath: string | null;
  root: string;
  registerStop: (stop: (() => void) | null) => void;
  log: (line: string) => void;
};

async function markFailed(ctx: Context, id: string, error: string) {
  await ctx.prisma.researchReport.updateMany({
    where: { id, status: "running" },
    data: { status: "failed", error: tailText(error) || "Unknown error.", completedAt: new Date() },
  });
}

export async function processReport(ctx: Context, report: ResearchReport): Promise<"ready" | "failed" | "requeued"> {
  const dir = join(ctx.root, report.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // A retried report must not pick up a previous attempt's PDF.
  for (const file of Object.values(OUTPUT_FILES)) await rm(join(dir, file), { force: true });

  const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const prompt = buildResearchPrompt({ topic: report.topic, workDir: dir, monthLabel, skillPath: ctx.skillPath });
  const started = Date.now();
  ctx.log(`Research ${report.id}: running`);
  const run = await runClaude({ bin: ctx.bin, args: claudeArgs(prompt), cwd: dir, env: ctx.env, timeoutMs: ctx.timeoutMs, registerStop: ctx.registerStop });
  ctx.registerStop(null);
  const minutes = Math.round((Date.now() - started) / 60_000);
  const parsed = parseClaudeResult(run.stdout);
  ctx.log(`Research ${report.id}: claude exited (code ${run.code ?? run.signal}) after ${minutes} min${parsed?.costUsd != null ? `, $${parsed.costUsd.toFixed(2)}` : ""}`);

  if (run.stopped) {
    await requeueReport(ctx.prisma, report.id);
    ctx.log(`Research ${report.id}: requeued (worker stopping)`);
    return "requeued";
  }
  const pdfPath = join(dir, OUTPUT_FILES.pdf);
  if (run.timedOut || !(await isPdf(pdfPath))) {
    const output = parsed?.result ?? `${run.stdout}\n${run.stderr}`;
    const reason = run.timedOut
      ? `Timed out after ${Math.round(ctx.timeoutMs / 60_000)} minutes.`
      : `Claude finished without ${OUTPUT_FILES.pdf} (exit ${run.code ?? run.signal}).`;
    await markFailed(ctx, report.id, `${reason} ${tailText(output, 400)}`);
    ctx.log(`Research ${report.id}: failed (${run.timedOut ? "timeout" : "no pdf"})`);
    return "failed";
  }

  const [titleRaw, summaryRaw, sourcesRaw, pageCount] = await Promise.all([
    readOptional(join(dir, OUTPUT_FILES.title)),
    readOptional(join(dir, OUTPUT_FILES.summary)),
    readOptional(join(dir, OUTPUT_FILES.sources)),
    pdfPageCount(pdfPath),
  ]);
  const blob = await put(researchBlobKey(report.userId, report.id), await readFile(pdfPath), {
    access: "public", addRandomSuffix: false, contentType: "application/pdf", token: ctx.blobToken,
  });
  const sources = parseSources(sourcesRaw);
  const { count } = await ctx.prisma.researchReport.updateMany({
    where: { id: report.id, status: "running" },
    data: {
      status: "ready",
      pdfUrl: blob.url,
      pageCount,
      title: cleanTitle(titleRaw) ?? report.title,
      summary: cleanSummary(summaryRaw),
      ...(sources ? { sourcesJson: sources } : {}),
      error: null,
      completedAt: new Date(),
    },
  });
  if (count === 0) {
    // Deleted (or failed as stale) while it ran: don't leave the PDF behind.
    await del(blob.url, { token: ctx.blobToken }).catch(() => {});
    ctx.log(`Research ${report.id}: row gone before completion; upload removed`);
    return "failed";
  }
  ctx.log(`Research ${report.id}: ready (${pageCount ?? "?"} pages)`);
  return "ready";
}

export async function runResearchWorker(argv: string[]): Promise<number> {
  const flags = parseWorkerFlags(argv);
  const env = childEnv({ ...process.env });
  try { process.loadEnvFile(".env"); } catch {}
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!process.env.DATABASE_URL || !blobToken) throw new Error("DATABASE_URL and BLOB_READ_WRITE_TOKEN are required");
  const emails = allowedEmails(process.env);
  const limit = timeoutMs(process.env);
  const root = researchRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await sweepOldWorkDirs(root);

  const prisma = new PrismaClient();
  let stopping = false;
  let stopCurrent: (() => void) | null = null;
  let wake: (() => void) | null = null;
  const onSignal = () => {
    stopping = true;
    stopCurrent?.();
    wake?.();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  const ctx: Context = {
    prisma, blobToken, bin: claudeBin(process.env), env, timeoutMs: limit, root,
    skillPath: await findDeepResearchSkill(),
    registerStop: (stop) => { stopCurrent = stop; if (stop && stopping) stop(); },
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  };
  if (!ctx.skillPath) ctx.log("Research worker: deep-research SKILL.md not found under ~/.claude/skills; relying on the Skill tool");
  ctx.log(`Research worker: started${flags.once ? " (--once)" : ""}, timeout ${Math.round(limit / 60_000)} min`);

  try {
    while (!stopping) {
      let processed = false;
      try {
        // Leave room for the kill grace period before calling a run abandoned.
        const stale = await failStaleReports(prisma, new Date(Date.now() - limit - 5 * 60_000));
        if (stale) ctx.log(`Research worker: marked ${stale} abandoned report(s) failed`);
        const report = await claimNextReport(prisma, { allowedEmails: emails });
        if (report) {
          processed = true;
          try {
            await processReport(ctx, report);
          } catch (error) {
            const message = error instanceof Error ? error.message : "unknown error";
            await markFailed(ctx, report.id, message).catch(() => {});
            ctx.log(`Research ${report.id}: failed (${error instanceof Error ? error.name : "error"})`);
          }
        }
      } catch (error) {
        ctx.log(`Research worker: poll failed (${error instanceof Error ? error.name : "error"})`);
      }
      if (flags.once) break;
      if (processed || stopping) continue;
      await new Promise<void>((done) => {
        const timer = setTimeout(done, POLL_MS);
        wake = () => { clearTimeout(timer); done(); };
      });
      wake = null;
    }
  } finally {
    await prisma.$disconnect();
  }
  ctx.log("Research worker: stopped");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runResearchWorker(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(`Research worker could not start (${e instanceof Error ? e.message : "unknown error"}).`); process.exitCode = 1; });
}
