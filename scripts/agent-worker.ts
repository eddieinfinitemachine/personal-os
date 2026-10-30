/**
 * Todo agent worker: turns queued code jobs (src/lib/agent/triage.ts) into
 * pull requests. Claims the oldest queued job, checks the repository out in
 * its own clone under ~/Library/Application Support/personal-os/agent/, runs
 * Claude Code headless on a fresh branch, then pushes the branch, opens the
 * PR with `gh`, marks the job done, comments on the todo and posts to Slack.
 * Polls every 30 s; SIGTERM stops it cleanly and puts a running job back.
 *
 *   pnpm exec tsx scripts/agent-worker.ts [--once]
 *
 * --once processes at most one job, then exits. Needs DATABASE_URL (from .env
 * in the working directory), `claude`, `git` and an authenticated `gh`. Only
 * claims jobs belonging to AGENT_ALLOWED_EMAILS (comma-separated; defaults to
 * FOUNDER_EMAIL) for repositories in AGENT_REPOS, because Claude runs here with
 * every permission. Stops claiming when the last 24 hours of jobs cost more
 * than AGENT_DAILY_BUDGET_USD (default 25). Logs ids, statuses and costs only,
 * never todo text.
 *
 * The clones under agent/repos are the worker's own: it resets and cleans them
 * before every job. It never touches any other checkout on this machine.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient, type AgentJob } from "@prisma/client";
import { claimNextJob, failStaleJobs, requeueJob, spentLastDay } from "../src/lib/agent/claim";
import { MAX_SUMMARY_CHARS, branchName, clip, parseAgentRepos } from "../src/lib/agent/job";
import { OUTPUT_FILES, buildCodePrompt, claudeArgs } from "../src/lib/agent/prompt";
import { parseClaudeResult, tailText } from "../src/lib/research/outputs";
import { postSlackMessage } from "../src/lib/slack";

export const POLL_MS = 30_000;
export const DEFAULT_TIMEOUT_MIN = 60;
export const DEFAULT_DAILY_BUDGET_USD = 25;
const KILL_GRACE_MS = 10_000;
const MAX_CAPTURE_CHARS = 1_000_000;
const GIT_TIMEOUT_MS = 10 * 60_000;

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
  const raw = env.AGENT_ALLOWED_EMAILS ?? env.FOUNDER_EMAIL ?? "emcohen@me.com";
  return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function timeoutMs(env: Env): number {
  const minutes = Number(env.AGENT_TIMEOUT_MIN);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TIMEOUT_MIN) * 60_000;
}

export function dailyBudgetUsd(env: Env): number {
  const usd = Number(env.AGENT_DAILY_BUDGET_USD);
  return Number.isFinite(usd) && usd >= 0 ? usd : DEFAULT_DAILY_BUDGET_USD;
}

const agentRoot = () => join(homedir(), "Library/Application Support/personal-os/agent");

function claudeBin(env: Env): string {
  if (env.AGENT_CLAUDE_BIN) return env.AGENT_CLAUDE_BIN;
  const local = join(homedir(), ".local/bin/claude");
  return existsSync(local) ? local : "claude";
}

/**
 * Environment for child processes: launchd's minimal env plus the usual tool
 * paths. Built before .env is loaded, so the production DATABASE_URL and the
 * Slack token never reach a process running with every permission.
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

export type Context = {
  prisma: PrismaClient;
  bin: string;
  ghBin: string;
  env: Env;
  timeoutMs: number;
  root: string;
  allowedRepos: string[];
  /** Where to clone `owner/name` from (tests point this at a local repository). */
  repoUrl: (repo: string) => string;
  registerStop: (stop: (() => void) | null) => void;
  log: (line: string) => void;
  notify: (text: string) => Promise<unknown>;
};

async function exec(ctx: Context, bin: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await promisify(execFile)(bin, args, { cwd, env: ctx.env as NodeJS.ProcessEnv, timeout: GIT_TIMEOUT_MS, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

const git = (ctx: Context, dir: string, ...args: string[]) => exec(ctx, "git", ["-C", dir, ...args], dir);

/**
 * The worker's own clone of `repo`, fetched and reset to the default branch,
 * with `branch` checked out fresh from it. Returns the default branch name.
 */
async function prepareRepo(ctx: Context, repo: string, branch: string): Promise<{ dir: string; base: string }> {
  const dir = join(ctx.root, "repos", repo.replace("/", "__"));
  await mkdir(join(ctx.root, "repos"), { recursive: true, mode: 0o700 });
  if (!existsSync(join(dir, ".git"))) {
    await exec(ctx, "git", ["clone", "--quiet", ctx.repoUrl(repo), dir], ctx.root);
  }
  await git(ctx, dir, "fetch", "--quiet", "--prune", "origin");
  const head = await git(ctx, dir, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD").catch(() => "");
  const base = head.replace("refs/remotes/origin/", "") || "main";
  // Only this clone is touched: a previous job's leftovers must never leak into the next PR.
  await git(ctx, dir, "reset", "--quiet", "--hard");
  await git(ctx, dir, "clean", "--quiet", "-fd");
  await git(ctx, dir, "checkout", "--quiet", "-B", branch, `origin/${base}`);
  return { dir, base };
}

async function finish(ctx: Context, job: AgentJob, data: Record<string, unknown>): Promise<boolean> {
  const { count } = await ctx.prisma.agentJob.updateMany({ where: { id: job.id, status: "running" }, data: { ...data, completedAt: new Date() } });
  return count === 1;
}

async function markFailed(ctx: Context, job: AgentJob, error: string, extra: Record<string, unknown> = {}) {
  await finish(ctx, job, { status: "failed", error: tailText(error) || "Unknown error.", ...extra });
}

async function commentOnTodo(ctx: Context, job: AgentJob, body: string) {
  await ctx.prisma.comment.create({ data: { todoId: job.todoId, authorId: job.userId, body } }).catch((error: unknown) => {
    ctx.log(`Agent ${job.id}: could not comment on the todo (${error instanceof Error ? error.name : "error"})`);
  });
}

export async function processJob(ctx: Context, job: AgentJob): Promise<"done" | "failed" | "requeued"> {
  const todo = await ctx.prisma.todo.findUnique({ where: { id: job.todoId }, select: { title: true, notes: true } });
  if (!todo) {
    await markFailed(ctx, job, "The todo was deleted before the agent started.");
    ctx.log(`Agent ${job.id}: failed (todo gone)`);
    return "failed";
  }
  if (!job.repo || !ctx.allowedRepos.includes(job.repo)) {
    await markFailed(ctx, job, `Repository ${job.repo ?? "(none)"} is not in AGENT_REPOS on this machine.`);
    ctx.log(`Agent ${job.id}: failed (repo not allowed)`);
    return "failed";
  }

  const jobDir = join(ctx.root, "jobs", job.id);
  await mkdir(jobDir, { recursive: true, mode: 0o700 });
  await rm(join(jobDir, OUTPUT_FILES.summary), { force: true });
  const branch = branchName(job.id, todo.title);
  await ctx.prisma.agentJob.updateMany({ where: { id: job.id }, data: { branch } });

  let repoDir: string;
  let base: string;
  try {
    ({ dir: repoDir, base } = await prepareRepo(ctx, job.repo, branch));
  } catch (error) {
    await markFailed(ctx, job, `Could not prepare ${job.repo}: ${error instanceof Error ? error.message : "unknown error"}`);
    ctx.log(`Agent ${job.id}: failed (repo prepare)`);
    return "failed";
  }

  const prompt = buildCodePrompt({ title: todo.title, notes: todo.notes, plan: job.plan, repo: job.repo, repoDir, branch, jobDir });
  const started = Date.now();
  ctx.log(`Agent ${job.id}: running (${job.repo}, ${branch})`);
  await ctx.notify(`Started: *${todo.title}*\n${job.plan ?? ""}`.trim());
  const run = await runClaude({ bin: ctx.bin, args: claudeArgs(prompt), cwd: repoDir, env: ctx.env, timeoutMs: ctx.timeoutMs, registerStop: ctx.registerStop });
  ctx.registerStop(null);
  const minutes = Math.round((Date.now() - started) / 60_000);
  const parsed = parseClaudeResult(run.stdout);
  const costUsd = parsed?.costUsd ?? null;
  ctx.log(`Agent ${job.id}: claude exited (code ${run.code ?? run.signal}) after ${minutes} min${costUsd != null ? `, $${costUsd.toFixed(2)}` : ""}`);

  if (run.stopped) {
    await requeueJob(ctx.prisma, job.id);
    ctx.log(`Agent ${job.id}: requeued (worker stopping)`);
    return "requeued";
  }

  const summary = clip(await readOptional(join(jobDir, OUTPUT_FILES.summary)), MAX_SUMMARY_CHARS);
  if (run.timedOut || !summary) {
    const output = parsed?.result ?? `${run.stdout}\n${run.stderr}`;
    const reason = run.timedOut
      ? `Timed out after ${Math.round(ctx.timeoutMs / 60_000)} minutes.`
      : `Claude finished without ${OUTPUT_FILES.summary} (exit ${run.code ?? run.signal}).`;
    await markFailed(ctx, job, `${reason} ${tailText(output, 400)}`, { costUsd });
    await ctx.notify(`Failed: *${todo.title}*\n${reason}`);
    ctx.log(`Agent ${job.id}: failed (${run.timedOut ? "timeout" : "no summary"})`);
    return "failed";
  }

  const commits = Number(await git(ctx, repoDir, "rev-list", "--count", `origin/${base}..${branch}`).catch(() => "0"));
  if (!commits) {
    const done = await finish(ctx, job, { status: "done", summary, costUsd, resultUrl: null });
    if (done) await commentOnTodo(ctx, job, `Agent looked at this and made no change.\n\n${summary}`);
    await ctx.notify(`No change: *${todo.title}*\n${summary}`);
    ctx.log(`Agent ${job.id}: done (no commits)`);
    return "done";
  }

  let prUrl: string;
  try {
    await git(ctx, repoDir, "push", "--quiet", "-u", "origin", branch);
    const body = `${summary}\n\nOpened by the personal-os todo agent for todo ${job.todoId}.`;
    const out = await exec(ctx, ctx.ghBin, ["pr", "create", "--repo", job.repo, "--head", branch, "--base", base, "--title", clip(todo.title, 120) ?? branch, "--body", body], repoDir);
    prUrl = /https?:\/\/\S+/.exec(out)?.[0] ?? "";
    if (!prUrl) throw new Error(`gh pr create printed no URL: ${tailText(out, 200)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await markFailed(ctx, job, `Committed on ${branch} but could not open the PR: ${message}`, { costUsd, summary });
    await ctx.notify(`Failed to open a PR: *${todo.title}*\nBranch ${branch} in ${job.repo}. ${tailText(message, 200)}`);
    ctx.log(`Agent ${job.id}: failed (push or PR)`);
    return "failed";
  }

  const done = await finish(ctx, job, { status: "done", summary, costUsd, resultUrl: prUrl });
  if (!done) {
    ctx.log(`Agent ${job.id}: row gone before completion; PR ${prUrl} left open`);
    return "failed";
  }
  await commentOnTodo(ctx, job, `Agent opened a pull request: ${prUrl}\n\n${summary}`);
  await ctx.notify(`PR ready: *${todo.title}*\n${prUrl}\n${summary}`);
  ctx.log(`Agent ${job.id}: done (${commits} commit${commits === 1 ? "" : "s"})`);
  return "done";
}

export async function runAgentWorker(argv: string[]): Promise<number> {
  const flags = parseWorkerFlags(argv);
  const env = childEnv({ ...process.env });
  try { process.loadEnvFile(".env"); } catch {}
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const emails = allowedEmails(process.env);
  const limit = timeoutMs(process.env);
  const budget = dailyBudgetUsd(process.env);
  const allowedRepos = parseAgentRepos(process.env.AGENT_REPOS).map((r) => r.name);
  const root = agentRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const slackEnv = { SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN, SLACK_AGENT_CHANNEL: process.env.SLACK_AGENT_CHANNEL };

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

  const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
  const ctx: Context = {
    prisma, bin: claudeBin(process.env), ghBin: process.env.AGENT_GH_BIN ?? "gh", env, timeoutMs: limit, root, allowedRepos,
    repoUrl: (repo) => `https://github.com/${repo}.git`,
    registerStop: (stop) => { stopCurrent = stop; if (stop && stopping) stop(); },
    log,
    notify: (text) => postSlackMessage(text, { env: slackEnv, log }),
  };
  if (!allowedRepos.length) log("Agent worker: AGENT_REPOS is empty; every job will fail");
  if (!slackEnv.SLACK_BOT_TOKEN) log("Agent worker: SLACK_BOT_TOKEN not set; not posting to Slack");
  log(`Agent worker: started${flags.once ? " (--once)" : ""}, timeout ${Math.round(limit / 60_000)} min, budget $${budget}/day`);

  try {
    while (!stopping) {
      let processed = false;
      try {
        // Leave room for the kill grace period before calling a run abandoned.
        const stale = await failStaleJobs(prisma, new Date(Date.now() - limit - 5 * 60_000));
        if (stale) log(`Agent worker: marked ${stale} abandoned job(s) failed`);
        const spent = await spentLastDay(prisma);
        if (spent >= budget) {
          log(`Agent worker: $${spent.toFixed(2)} spent in the last 24 h, over the $${budget} budget; not claiming`);
        } else {
          const job = await claimNextJob(prisma, { allowedEmails: emails });
          if (job) {
            processed = true;
            try {
              await processJob(ctx, job);
            } catch (error) {
              const message = error instanceof Error ? error.message : "unknown error";
              await markFailed(ctx, job, message).catch(() => {});
              log(`Agent ${job.id}: failed (${error instanceof Error ? error.name : "error"})`);
            }
          }
        }
      } catch (error) {
        log(`Agent worker: poll failed (${error instanceof Error ? error.name : "error"})`);
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
  log("Agent worker: stopped");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAgentWorker(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(`Agent worker could not start (${e instanceof Error ? e.message : "unknown error"}).`); process.exitCode = 1; });
}
