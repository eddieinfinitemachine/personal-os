/**
 * Improve worker: turns "Improve" requests typed in the app into shipped changes.
 * Claims the oldest approved improvement (to ship) or else the oldest queued
 * one (to implement). Implementing: a fresh git worktree from origin/main,
 * Claude Code headless makes and commits the change, then the worker rebases
 * onto main, runs typecheck/test/build itself, pushes, opens a PR and either
 * merges it (low risk, see src/lib/improvements/gate.ts) or stops at
 * needs_review. Shipping an approved PR: rebase, re-check, apply the PR's new
 * prisma/changes/*.sql files to production (never a whole-schema db push), merge. Polls every 30 s; SIGTERM stops it and
 * puts a job that hasn't pushed yet back in the queue.
 *
 *   pnpm exec tsx scripts/improve-worker.ts [--once]
 *
 * Runs from the personal-os-sync checkout (its cwd is the repo). Needs
 * DATABASE_URL (from .env; only `prisma db execute` of an approved PR's
 * prisma/changes SQL ever sees it), plus claude, gh (logged in), pnpm and git. Only claims
 * improvements belonging to IMPROVE_ALLOWED_EMAILS (comma-separated; defaults
 * to FOUNDER_EMAIL), because Claude runs here with every permission.
 * Logs ids, statuses and durations only, never request text or branch names.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, type Improvement, type Prisma } from "@prisma/client";
import {
  claimNextImprovement, failStaleImprovements, requeueImprovement,
  type ClaimedImprovement, type ImprovementJobKind, type ImprovementQueueDb,
} from "../src/lib/improvements/claim";
import { assessRisk, parseAddedLines, parseNumstat } from "../src/lib/improvements/gate";
import { RESULT_FILE, buildImprovePrompt, improveClaudeArgs, parseImproveResult, type ImproveResult } from "../src/lib/improvements/prompt";
import { parseContext } from "../src/lib/improvements/request";
import { cleanSummary, parseClaudeResult, tailText } from "../src/lib/research/outputs";
import { childEnv, claudeBin, describeError, parseWorkerFlags, runCommand, untilSaved, type Env, type RunResult } from "./lib/headless-claude";

export { parseWorkerFlags };

export const POLL_MS = 30_000;
export const DEFAULT_TIMEOUT_MIN = 40;
const FINISH_ATTEMPTS = 30;
export const FINISH_RETRY_MS = 60_000;
const DEPLOY_POLL_MS = 20_000;
const DEPLOY_WAIT_MS = 15 * 60_000;
const PREVIEW_WAIT_MS = 3 * 60_000;
const GIT_TIMEOUT_MS = 2 * 60_000;
const GH_TIMEOUT_MS = 2 * 60_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const DB_EXECUTE_TIMEOUT_MS = 5 * 60_000;
const CHECKS = [
  { name: "typecheck", timeoutMs: 10 * 60_000 },
  { name: "test", timeoutMs: 15 * 60_000 },
  { name: "build", timeoutMs: 20 * 60_000 },
] as const;
/** Install, checks, deploy wait and slack on top of Claude's own timeout. */
const STALE_MARGIN_MS = 90 * 60_000;
const MAX_ERROR_CHARS = 500;
/** Checks get a database that can't be reached, so nothing real is ever touched. */
export const CHECK_DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/invalid";
const MAIN_REFSPEC = "+refs/heads/main:refs/remotes/origin/main";
const PRODUCTION = /^production\b/i;
const PREVIEW = /^preview\b/i;
/** Variables no child of the worker may inherit (VERCEL_ENV=production would make `pnpm build` push the schema). */
const STRIPPED_ENV = ["DATABASE_URL", "DIRECT_URL", "BLOB_READ_WRITE_TOKEN", "VERCEL_ENV"];

export type Outcome = "shipped" | "needs_review" | "failed" | "requeued";

export type Runner = (bin: string, args: string[], options: { cwd: string; env: Env; timeoutMs: number; signal?: AbortSignal }) => Promise<RunResult>;

export type Context = {
  prisma: ImprovementQueueDb;
  /** The checkout the worker runs in (personal-os-sync); improve worktrees hang off it. */
  repoDir: string;
  /** owner/repo on GitHub, always passed to gh as --repo. */
  repo: string;
  /** ~/Code/.worktrees */
  worktreeRoot: string;
  /** ~/Library/Application Support/personal-os/improvements */
  resultsRoot: string;
  claudeBin: string;
  /** Environment for every child: no DATABASE_URL, no Blob token. */
  env: Env;
  /** The real DATABASE_URL: only `prisma db execute` of an approved PR's SQL change files gets it. */
  databaseUrl: string;
  /** Claude's time limit. */
  timeoutMs: number;
  /** Runs every external command (git, pnpm, gh, claude). */
  run: Runner;
  /** Keeps the Mac awake while a job runs; returns a release function. */
  keepAwake: (env: Env) => () => void;
  registerStop: (stop: (() => void) | null) => void;
  log: (line: string) => void;
  /** Wait between attempts to record an outcome (FINISH_RETRY_MS). */
  retryMs: number;
  /** Between deployment polls (20 s). */
  pollMs: number;
  /** How long to wait for the production deploy of a merge (15 min). */
  deployWaitMs: number;
  /** How long to wait for a preview URL before stopping for review (3 min). */
  previewWaitMs: number;
};

type Job = {
  id: string;
  kind: ImprovementJobKind;
  branch: string;
  dir: string;
  /** Holds result.json; gh runs here, outside any git checkout. */
  resultDir: string;
  signal: AbortSignal;
  /** The branch has commits of its own (worth keeping after a failure). */
  committed: boolean;
};

/** A failure whose message is fit for Eddie (saved as the row's error); `tag` is the log-safe label. */
class JobFailure extends Error {
  constructor(message: string, readonly tag: string, readonly summary: string | null = null) {
    super(message);
    this.name = "JobFailure";
  }
}

/** The worker was asked to stop while a stoppable step ran. */
class JobStopped extends Error {
  constructor() {
    super("stopped");
    this.name = "JobStopped";
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────

export function allowedEmails(env: Env): string[] {
  const raw = env.IMPROVE_ALLOWED_EMAILS ?? env.FOUNDER_EMAIL ?? "emcohen@me.com";
  return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function timeoutMs(env: Env): number {
  const minutes = Number(env.IMPROVE_TIMEOUT_MIN);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TIMEOUT_MIN) * 60_000;
}

/** childEnv minus anything that could reach real data or make a build act like production. */
export function workerEnv(base: Env): Env {
  const env = childEnv(base);
  for (const key of STRIPPED_ENV) delete env[key];
  return env;
}

/** github.com remote URL (https or ssh) → "owner/repo". */
export function parseGitHubRepo(remote: string): string | null {
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

export function slugify(text: string, max = 40): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return slug || "change";
}

export const branchName = (id: string, request: string) => `improve/${id.slice(0, 8)}-${slugify(request)}`;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function prTitle(request: string): string {
  const line = request.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).find(Boolean) ?? "Change";
  return `Improve: ${clip(line, 70)}`;
}

/** The request goes in a code fence: it is free text, and @mentions or markdown in it must stay inert. */
export function prBody(options: { request: string; summary: string | null; reasons: string[] }): string {
  const longestTicks = Math.max(0, ...(options.request.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestTicks + 1));
  return [
    "## Request",
    "",
    `${fence}text`,
    options.request.trim(),
    fence,
    "",
    "## What changed",
    "",
    options.summary ?? "The agent left no summary.",
    "",
    ...(options.reasons.length ? ["## Why it stopped for review", "", ...options.reasons.map((reason) => `- ${reason}`), ""] : []),
    "---",
    "Opened by the Personal OS improve worker.",
  ].join("\n");
}

const branchRefspec = (branch: string) => `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
const output = (result: RunResult) => `${result.stdout}\n${result.stderr}`;
const succeeded = (result: RunResult) => result.code === 0 && !result.timedOut;
const minutesSince = (started: number) => Math.round((Date.now() - started) / 60_000);

async function readOptional(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); } catch { return null; }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done) => {
    if (signal?.aborted) return done();
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      done();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

// ── Real side effects (replaced in tests) ──────────────────────────────────

export const runProcess: Runner = (bin, args, options) => runCommand({ bin, args, ...options });

/** `caffeinate -i` for the job, tied to this process; silently nothing when it isn't installed. */
export function keepAwake(env: Env): () => void {
  const child = spawn("caffeinate", ["-i", "-w", String(process.pid)], { env: env as NodeJS.ProcessEnv, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
  return () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
}

// ── Steps ──────────────────────────────────────────────────────────────────

async function exec(
  ctx: Context, job: Job, bin: string, args: string[],
  options: { cwd: string; env?: Env; timeoutMs: number; stoppable?: boolean },
): Promise<RunResult> {
  const result = await ctx.run(bin, args, {
    cwd: options.cwd, env: options.env ?? ctx.env, timeoutMs: options.timeoutMs, signal: options.stoppable ? job.signal : undefined,
  });
  if (result.stopped) throw new JobStopped();
  return result;
}

/** A command that must succeed: its stdout, or a JobFailure "<label> failed: <end of output>". */
async function step(
  ctx: Context, job: Job, label: string, bin: string, args: string[],
  options: { cwd: string; env?: Env; timeoutMs: number; stoppable?: boolean },
): Promise<string> {
  const result = await exec(ctx, job, bin, args, options);
  if (!succeeded(result)) throw new JobFailure(`${label} ${result.timedOut ? "timed out" : "failed"}: ${tailText(output(result), 400)}`, label);
  return result.stdout;
}

const git = (ctx: Context, job: Job, cwd: string, args: string[]) =>
  step(ctx, job, `git ${args[0]}`, "git", args, { cwd, timeoutMs: GIT_TIMEOUT_MS });

/**
 * gh always runs outside any git checkout and with an explicit --repo (or an
 * explicit API path): `gh pr merge --delete-branch` then deletes only the
 * remote branch and never tries to switch a local checkout.
 */
const gh = (ctx: Context, job: Job, args: string[]) =>
  step(ctx, job, `gh ${args.slice(0, 2).join(" ")}`, "gh", args, { cwd: job.resultDir, timeoutMs: GH_TIMEOUT_MS });

/** Best effort: removes the job's worktree (and optionally its local branch). */
async function removeWorktree(ctx: Context, job: Job, deleteBranch: boolean) {
  const options = { cwd: ctx.repoDir, env: ctx.env, timeoutMs: GIT_TIMEOUT_MS };
  await ctx.run("git", ["worktree", "remove", "--force", job.dir], options);
  if (existsSync(job.dir)) await rm(job.dir, { recursive: true, force: true });
  await ctx.run("git", ["worktree", "prune"], options);
  if (deleteBranch) await ctx.run("git", ["branch", "-D", job.branch], options);
}

const install = (ctx: Context, job: Job) =>
  step(ctx, job, "pnpm install", "pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: job.dir, timeoutMs: INSTALL_TIMEOUT_MS, stoppable: true });

/** Rebases the branch onto the latest main; false (with the rebase undone) when it doesn't apply cleanly. */
async function rebaseOntoMain(ctx: Context, job: Job): Promise<boolean> {
  await git(ctx, job, job.dir, ["fetch", "origin", MAIN_REFSPEC]);
  const options = { cwd: job.dir, timeoutMs: GIT_TIMEOUT_MS };
  // Already on top of main (e.g. Eddie merged main into the PR to resolve a conflict): nothing to do.
  if (succeeded(await exec(ctx, job, "git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], options))) return true;
  if (succeeded(await exec(ctx, job, "git", ["rebase", "origin/main"], options))) return true;
  await exec(ctx, job, "git", ["rebase", "--abort"], options);
  return false;
}

function checkEnv(env: Env, databaseUrl: string): Env {
  const clean = { ...env };
  for (const key of STRIPPED_ENV) delete clean[key];
  return { ...clean, DATABASE_URL: databaseUrl };
}

async function runChecks(ctx: Context, job: Job) {
  const env = checkEnv(ctx.env, CHECK_DATABASE_URL);
  for (const check of CHECKS) {
    await step(ctx, job, check.name, "pnpm", [check.name], { cwd: job.dir, env, timeoutMs: check.timeoutMs, stoppable: true });
  }
  ctx.log(`Improve ${job.id}: checks passed`);
}

async function assess(ctx: Context, job: Job, result: ImproveResult | null) {
  const range = "origin/main...HEAD";
  const numstat = await git(ctx, job, job.dir, ["-c", "core.quotePath=false", "diff", "--numstat", "-z", "--no-renames", range]);
  const diff = await git(ctx, job, job.dir, ["-c", "core.quotePath=false", "diff", "-U0", "--no-renames", "--no-color", range]);
  return assessRisk({
    files: parseNumstat(numstat),
    addedLines: parseAddedLines(diff),
    agentRisky: result?.risky ?? false,
    agentReason: result?.riskReason ?? null,
  });
}

const headSha = async (ctx: Context, job: Job) => (await git(ctx, job, job.dir, ["rev-parse", "HEAD"])).trim();

async function openPullRequest(ctx: Context, job: Job, request: string, summary: string | null, reasons: string[]): Promise<string> {
  const out = await gh(ctx, job, [
    "pr", "create", "--repo", ctx.repo, "--base", "main", "--head", job.branch,
    "--title", prTitle(request), "--body", prBody({ request, summary, reasons }),
  ]);
  const url = out.split("\n").map((line) => line.trim()).reverse().find((line) => /^https:\/\/\S+\/pull\/\d+$/.test(line));
  if (!url) throw new JobFailure("gh pr create printed no pull request URL.", "gh pr create");
  return url;
}

/** Latest status of the newest deployment of `sha` in a matching environment; null when none yet (or gh failed). */
async function latestDeployment(ctx: Context, job: Job, sha: string, environment: RegExp): Promise<{ state: string; url: string | null } | null> {
  try {
    const deployments: unknown = JSON.parse(await gh(ctx, job, ["api", `repos/${ctx.repo}/deployments?sha=${sha}`]));
    if (!Array.isArray(deployments)) return null;
    const match = deployments.find((d) => typeof d?.environment === "string" && environment.test(d.environment) && Number.isInteger(d.id));
    if (!match) return null;
    const statuses: unknown = JSON.parse(await gh(ctx, job, ["api", `repos/${ctx.repo}/deployments/${match.id}/statuses`]));
    const latest = Array.isArray(statuses) ? statuses[0] : null; // newest first
    if (!latest || typeof latest.state !== "string") return null;
    return { state: latest.state, url: typeof latest.environment_url === "string" && latest.environment_url ? latest.environment_url : null };
  } catch {
    return null; // Offline or not there yet: keep polling.
  }
}

/** Polls `probe` every pollMs until it returns non-null, `waitMs` passes or the worker stops. */
async function pollUntil<T>(ctx: Context, job: Job, waitMs: number, probe: () => Promise<T | null>): Promise<T | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (job.signal.aborted || Date.now() + ctx.pollMs > deadline) return null;
    await sleep(ctx.pollMs, job.signal);
  }
}

async function mergeCommitSha(ctx: Context, job: Job, prUrl: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(ctx.pollMs, job.signal);
    try {
      const view = JSON.parse(await gh(ctx, job, ["pr", "view", prUrl, "--repo", ctx.repo, "--json", "mergeCommit"]));
      const oid = view?.mergeCommit?.oid;
      if (typeof oid === "string" && /^[0-9a-f]{7,40}$/i.test(oid)) return oid;
    } catch {
      // Retry: GitHub can lag a moment behind the merge.
    }
  }
  return null;
}

function saveWithRetry<T>(ctx: Context, id: string, what: string, fn: () => Promise<T>): Promise<T> {
  return untilSaved(fn, {
    attempts: FINISH_ATTEMPTS,
    retryMs: ctx.retryMs,
    onRetry: (error) => ctx.log(`Improve ${id}: ${what} failed (${describeError(error)}); retrying`),
  });
}

/** Records an outcome (or a link) on a row this worker still holds as running; false when the row is gone or changed. */
async function save(ctx: Context, job: Job, what: string, data: Prisma.ImprovementUpdateManyMutationInput): Promise<boolean> {
  const { count } = await saveWithRetry(ctx, job.id, what, () => ctx.prisma.improvement.updateMany({ where: { id: job.id, status: "running" }, data }));
  if (count === 0) ctx.log(`Improve ${job.id}: row changed or deleted while it ran; ${what} skipped`);
  return count > 0;
}

/** Records the PR on the row; a row deleted or failed meanwhile must not be merged or reviewed. */
async function holdPullRequest(ctx: Context, job: Job, prUrl: string): Promise<boolean> {
  if (await save(ctx, job, "saving the pull request", { branch: job.branch, prUrl })) return true;
  ctx.log(`Improve ${job.id}: left the pull request open`);
  return false;
}

/** Merges the checked PR, waits for its production deploy, marks the row shipped and cleans up. */
async function mergeAndShip(ctx: Context, job: Job, options: { prUrl: string; head: string; summary: string | null }): Promise<Outcome> {
  const { prUrl, head, summary } = options;
  // --match-head-commit: merge exactly what was checked, or nothing.
  await gh(ctx, job, ["pr", "merge", prUrl, "--repo", ctx.repo, "--squash", "--delete-branch", "--match-head-commit", head]);
  ctx.log(`Improve ${job.id}: merged`);
  // From here the change is live on main: nothing below may turn the row into a failure.
  const mergedSha = await mergeCommitSha(ctx, job, prUrl);
  const deploy = mergedSha
    ? await pollUntil(ctx, job, ctx.deployWaitMs, async () => {
      const status = await latestDeployment(ctx, job, mergedSha, PRODUCTION);
      if (status?.state === "success") return "success" as const;
      if (status?.state === "failure" || status?.state === "error") return "failed" as const;
      return null;
    })
    : null;
  const note = deploy === "success"
    ? ""
    : deploy === "failed"
      ? " (The production deploy failed; check Vercel.)"
      : ` (Deploy not confirmed within ${Math.round(ctx.deployWaitMs / 60_000)} minutes.)`;
  await save(ctx, job, "saving the shipped change", {
    status: "shipped",
    summary: `${summary ?? "Shipped."}${note}`,
    branch: job.branch,
    prUrl,
    mergedSha,
    reviewReason: null,
    error: null,
    completedAt: new Date(),
  });
  await removeWorktree(ctx, job, true);
  ctx.log(`Improve ${job.id}: shipped (deploy ${deploy ?? "unconfirmed"})`);
  return "shipped";
}

async function implement(ctx: Context, job: Job, improvement: Improvement): Promise<Outcome> {
  // a. A fresh worktree from the latest main (replacing anything an earlier attempt left).
  await removeWorktree(ctx, job, true);
  await git(ctx, job, ctx.repoDir, ["fetch", "origin", MAIN_REFSPEC]);
  await git(ctx, job, ctx.repoDir, ["worktree", "add", "-b", job.branch, job.dir, "origin/main"]);
  await install(ctx, job);

  // c. Claude makes and commits the change.
  const resultPath = join(job.resultDir, RESULT_FILE);
  await rm(resultPath, { force: true });
  const prompt = buildImprovePrompt({ request: improvement.request, context: parseContext(improvement.context), resultPath });
  const started = Date.now();
  const run = await exec(ctx, job, ctx.claudeBin, improveClaudeArgs(prompt), { cwd: job.dir, timeoutMs: ctx.timeoutMs, stoppable: true });
  const parsed = parseClaudeResult(run.stdout);
  ctx.log(`Improve ${job.id}: claude exited (code ${run.code ?? run.signal}) after ${minutesSince(started)} min${parsed?.costUsd != null ? `, $${parsed.costUsd.toFixed(2)}` : ""}`);

  // d. result.json is the agent's last step: with it, a run that timed out while tidying up still counts.
  const result = parseImproveResult(await readOptional(resultPath));
  const agentSummary = result?.summary ?? null;
  const summary = agentSummary ?? cleanSummary(parsed?.result ?? null);
  if (!result && (run.timedOut || run.code !== 0 || parsed?.isError)) {
    const reason = run.timedOut
      ? `Timed out after ${Math.round(ctx.timeoutMs / 60_000)} minutes.`
      : `Claude stopped with an error (exit ${run.code ?? run.signal}).`;
    throw new JobFailure(`${reason} ${tailText(parsed?.result ?? output(run), 400)}`.trim(), run.timedOut ? "timeout" : "claude error");
  }
  if ((await git(ctx, job, job.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() !== job.branch) {
    throw new JobFailure("Claude left the worktree on another branch, so nothing was shipped.", "wrong branch", agentSummary);
  }
  const ahead = Number((await git(ctx, job, job.dir, ["rev-list", "--count", "origin/main..HEAD"])).trim());
  if (!ahead) throw new JobFailure(clip(`No change was made.${agentSummary ? ` ${agentSummary}` : ""}`, MAX_ERROR_CHARS), "no change", agentSummary);
  job.committed = true;
  if ((await git(ctx, job, job.dir, ["status", "--porcelain"])).trim()) {
    throw new JobFailure(clip(`Claude left uncommitted changes. ${summary ?? ""}`.trim(), MAX_ERROR_CHARS), "uncommitted", agentSummary);
  }

  // e. Onto the latest main; f. the worker's own checks (skipped on a conflict, which goes to review).
  const rebased = await rebaseOntoMain(ctx, job);
  if (rebased) await runChecks(ctx, job);
  else ctx.log(`Improve ${job.id}: conflicts with main`);

  // g. The risk gate.
  const gate = await assess(ctx, job, result);
  const reasons = rebased ? gate.reasons : ["conflicts with main", ...gate.reasons];

  // h. Push and open the PR (gh outside any checkout).
  const head = await headSha(ctx, job);
  await git(ctx, job, job.dir, ["push", "-u", "origin", job.branch]);
  const prUrl = await openPullRequest(ctx, job, improvement.request, summary, reasons);
  ctx.log(`Improve ${job.id}: pull request opened`);
  if (!(await holdPullRequest(ctx, job, prUrl))) return "failed";

  // j. Risky: stop for Eddie's approval, with a preview link if Vercel has one quickly.
  if (reasons.length) {
    const previewUrl = await pollUntil(ctx, job, ctx.previewWaitMs, async () => {
      const status = await latestDeployment(ctx, job, head, PREVIEW);
      return status?.state === "success" ? status.url : null;
    });
    await save(ctx, job, "saving the review request", {
      status: "needs_review",
      summary,
      reviewReason: reasons.join("; "),
      branch: job.branch,
      prUrl,
      previewUrl,
      error: null,
      completedAt: new Date(),
    });
    ctx.log(`Improve ${job.id}: needs review (${reasons.length} reason${reasons.length === 1 ? "" : "s"}${previewUrl ? ", preview ready" : ""})`);
    return "needs_review";
  }

  // i. Low risk: merge and ship.
  return mergeAndShip(ctx, job, { prUrl, head, summary });
}

/**
 * Applies exactly the SQL change files this PR adds (prisma/changes/*.sql, the
 * idempotent scripts Eddie reviewed before tapping "Ship it"). Never a
 * whole-schema `prisma db push`: that would also apply any unrelated drift
 * between this branch and production (lessons 2026-11-01).
 */
async function applySchemaChanges(ctx: Context, job: Job, changed: string[]) {
  const added = (await git(ctx, job, job.dir, ["diff", "--name-only", "--no-renames", "--diff-filter=A", "origin/main...HEAD", "--", "prisma/changes/"]))
    .split("\n").map((path) => path.trim()).filter((path) => path.endsWith(".sql")).sort();
  if (!added.length) {
    if (changed.includes("prisma/schema.prisma")) {
      throw new JobFailure("The schema changed but the PR adds no prisma/changes/*.sql file to apply; finish it by hand.", "no sql change file");
    }
    return;
  }
  if (!ctx.databaseUrl) throw new JobFailure("Applying the schema change needs DATABASE_URL in the worker's .env.", "db execute");
  // The only children that get the real DATABASE_URL.
  for (const file of added) {
    await step(ctx, job, `apply ${file}`, "pnpm", ["exec", "prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", file], {
      cwd: job.dir, env: checkEnv(ctx.env, ctx.databaseUrl), timeoutMs: DB_EXECUTE_TIMEOUT_MS,
    });
  }
  ctx.log(`Improve ${job.id}: applied ${added.length} schema change file${added.length === 1 ? "" : "s"}`);
}

async function ship(ctx: Context, job: Job, improvement: Improvement): Promise<Outcome> {
  if (!improvement.prUrl || !/^improve\/[A-Za-z0-9._/-]+$/.test(job.branch)) {
    throw new JobFailure("Nothing to ship: no improve branch or pull request was recorded.", "nothing to ship");
  }
  await git(ctx, job, ctx.repoDir, ["fetch", "origin", MAIN_REFSPEC, branchRefspec(job.branch)]);
  if (existsSync(join(job.dir, ".git"))) {
    // Ship the pull request as it is on GitHub now: Eddie may have edited it before approving.
    await git(ctx, job, job.dir, ["reset", "--hard", `origin/${job.branch}`]);
  } else {
    await removeWorktree(ctx, job, false);
    await git(ctx, job, ctx.repoDir, ["worktree", "add", "-B", job.branch, job.dir, `origin/${job.branch}`]);
  }
  await install(ctx, job);
  if (!(await rebaseOntoMain(ctx, job))) throw new JobFailure("conflicts with main; resolve the PR by hand", "conflict");
  await runChecks(ctx, job);
  const changed = (await git(ctx, job, job.dir, ["diff", "--name-only", "--no-renames", "origin/main...HEAD"])).split("\n").map((path) => path.trim());
  await applySchemaChanges(ctx, job, changed);
  const head = await headSha(ctx, job);
  await git(ctx, job, job.dir, ["push", "--force-with-lease", "origin", job.branch]);
  if (!(await holdPullRequest(ctx, job, improvement.prUrl))) return "failed";
  return mergeAndShip(ctx, job, { prUrl: improvement.prUrl, head, summary: improvement.summary });
}

export async function processImprovement(ctx: Context, claimed: ClaimedImprovement): Promise<Outcome> {
  const { improvement, kind } = claimed;
  const abort = new AbortController();
  const job: Job = {
    id: improvement.id,
    kind,
    branch: kind === "ship" ? (improvement.branch ?? "") : branchName(improvement.id, improvement.request),
    dir: join(ctx.worktreeRoot, `personal-os-improve-${improvement.id.slice(0, 8)}`),
    resultDir: join(ctx.resultsRoot, improvement.id),
    signal: abort.signal,
    committed: kind === "ship",
  };
  await mkdir(job.resultDir, { recursive: true, mode: 0o700 });
  ctx.registerStop(() => abort.abort());
  const release = ctx.keepAwake(ctx.env);
  const started = Date.now();
  ctx.log(`Improve ${job.id}: running (${kind})`);
  try {
    return kind === "ship" ? await ship(ctx, job, improvement) : await implement(ctx, job, improvement);
  } catch (error) {
    if (error instanceof JobStopped) {
      // Stoppable steps all come before the push, so nothing is on GitHub yet.
      if (kind === "implement") await removeWorktree(ctx, job, true);
      await requeueImprovement(ctx.prisma, job.id, kind).catch(() => {});
      ctx.log(`Improve ${job.id}: requeued (worker stopping)`);
      return "requeued";
    }
    const message = error instanceof Error && error.message ? error.message : "Unknown error.";
    const summary = error instanceof JobFailure ? error.summary : null;
    await save(ctx, job, "saving the failure", {
      status: "failed",
      error: clip(message, MAX_ERROR_CHARS),
      ...(summary ? { summary } : {}),
      completedAt: new Date(),
    });
    // Keep the local branch only when it holds commits worth a look.
    await removeWorktree(ctx, job, !job.committed).catch(() => {});
    ctx.log(`Improve ${job.id}: failed (${error instanceof JobFailure ? error.tag : describeError(error)}) after ${minutesSince(started)} min`);
    return "failed";
  } finally {
    ctx.registerStop(null);
    release();
  }
}

export async function runImproveWorker(argv: string[]): Promise<number> {
  const flags = parseWorkerFlags(argv);
  // Built before .env is loaded: no child ever inherits the production DATABASE_URL.
  const env = workerEnv({ ...process.env });
  try { process.loadEnvFile(".env"); } catch {}
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const repoDir = process.cwd();
  const remote = await runCommand({ bin: "git", args: ["remote", "get-url", "origin"], cwd: repoDir, env, timeoutMs: 30_000 });
  const repo = succeeded(remote) ? parseGitHubRepo(remote.stdout) : null;
  if (!repo) throw new Error("the working directory's origin is not a GitHub repository");
  const emails = allowedEmails(process.env);
  const limit = timeoutMs(process.env);
  const resultsRoot = join(homedir(), "Library/Application Support/personal-os/improvements");
  const worktreeRoot = join(homedir(), "Code/.worktrees");
  await mkdir(resultsRoot, { recursive: true, mode: 0o700 });
  await mkdir(worktreeRoot, { recursive: true });

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
    prisma, repoDir, repo, worktreeRoot, resultsRoot, env, databaseUrl,
    claudeBin: claudeBin(process.env.IMPROVE_CLAUDE_BIN),
    timeoutMs: limit,
    run: runProcess,
    keepAwake,
    registerStop: (stop) => { stopCurrent = stop; if (stop && stopping) stop(); },
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
    retryMs: FINISH_RETRY_MS,
    pollMs: DEPLOY_POLL_MS,
    deployWaitMs: DEPLOY_WAIT_MS,
    previewWaitMs: PREVIEW_WAIT_MS,
  };
  ctx.log(`Improve worker: started${flags.once ? " (--once)" : ""}, timeout ${Math.round(limit / 60_000)} min`);

  try {
    while (!stopping) {
      let processed = false;
      try {
        const stale = await failStaleImprovements(prisma, new Date(Date.now() - limit - STALE_MARGIN_MS));
        if (stale) ctx.log(`Improve worker: marked ${stale} abandoned improvement(s) failed`);
        const claimed = await claimNextImprovement(prisma, { allowedEmails: emails });
        if (claimed) {
          processed = true;
          try {
            await processImprovement(ctx, claimed);
          } catch (error) {
            const message = error instanceof Error ? error.message : "unknown error";
            await prisma.improvement.updateMany({
              where: { id: claimed.improvement.id, status: "running" },
              data: { status: "failed", error: clip(message, MAX_ERROR_CHARS), completedAt: new Date() },
            }).catch(() => {});
            ctx.log(`Improve ${claimed.improvement.id}: failed (${describeError(error)})`);
          }
        }
      } catch (error) {
        ctx.log(`Improve worker: poll failed (${describeError(error)})`);
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
  ctx.log("Improve worker: stopped");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runImproveWorker(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(`Improve worker could not start (${e instanceof Error ? e.message : "unknown error"}).`); process.exitCode = 1; });
}
