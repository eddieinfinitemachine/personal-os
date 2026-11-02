// Shared plumbing for the Mac workers that run Claude Code headless
// (scripts/research-worker.ts, scripts/improve-worker.ts): spawning a child in
// its own process group with a timeout, the child environment, and retrying
// the writes that record a finished run.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Env = Record<string, string | undefined>;

export type RunResult = { code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; stopped: boolean; stdout: string; stderr: string };

export type WorkerFlags = { once: boolean };

export const KILL_GRACE_MS = 10_000;
const MAX_CAPTURE_CHARS = 1_000_000;

export function parseWorkerFlags(argv: string[]): WorkerFlags {
  const flags: WorkerFlags = { once: false };
  for (const arg of argv) {
    if (arg === "--once") flags.once = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return flags;
}

/** `override` (e.g. RESEARCH_CLAUDE_BIN), else ~/.local/bin/claude, else `claude` on PATH. */
export function claudeBin(override?: string): string {
  if (override) return override;
  const local = join(homedir(), ".local/bin/claude");
  return existsSync(local) ? local : "claude";
}

/**
 * Environment for children: launchd's minimal env plus the usual tool paths.
 * Workers build it before loading .env, so the production DATABASE_URL and
 * the Blob token never reach a process running with every permission.
 */
export function childEnv(base: Env): Env {
  const extra = [join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const path = [...new Set([...extra, ...(base.PATH ?? "").split(":").filter(Boolean)])].join(":");
  return { ...base, PATH: path };
}

export const capture = (text: string, chunk: Buffer) => (text + chunk.toString("utf8")).slice(-MAX_CAPTURE_CHARS);

export function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    // detached: the child leads its own process group, so its children die with it.
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

export type RunOptions = {
  bin: string;
  args: string[];
  cwd: string;
  env: Env;
  timeoutMs: number;
  /** Receives a function that stops the run (the worker was asked to stop). */
  registerStop?: (stop: () => void) => void;
  /** Same, as a signal: aborting stops the run. */
  signal?: AbortSignal;
  killGraceMs?: number;
};

/**
 * Runs a command detached in its own process group and captures the end of
 * its output. On timeout or stop: SIGTERM to the whole group, SIGKILL after a
 * grace period. Never rejects; a missing binary comes back as a non-zero code.
 */
export function runCommand(options: RunOptions): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(options.bin, options.args, { cwd: options.cwd, env: options.env as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const result: RunResult = { code: null, signal: null, timedOut: false, stopped: false, stdout: "", stderr: "" };
    child.stdout.on("data", (chunk: Buffer) => { result.stdout = capture(result.stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { result.stderr = capture(result.stderr, chunk); });
    let graceTimer: NodeJS.Timeout | null = null;
    let closed = false;
    const terminate = () => {
      if (closed) return;
      killGroup(child, "SIGTERM");
      graceTimer ??= setTimeout(() => killGroup(child, "SIGKILL"), options.killGraceMs ?? KILL_GRACE_MS);
    };
    const stop = () => { if (closed) return; result.stopped = true; terminate(); };
    const timer = setTimeout(() => { result.timedOut = true; terminate(); }, options.timeoutMs);
    options.registerStop?.(stop);
    if (options.signal?.aborted) stop();
    else options.signal?.addEventListener("abort", stop, { once: true });
    child.on("error", (error) => { result.stderr += `\n${error.message}`; });
    child.on("close", (code, signal) => {
      closed = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", stop);
      result.code = code;
      result.signal = signal;
      resolvePromise(result);
    });
  });
}

/** The headless `claude -p` run: the same process-group handling as any command. */
export const runClaude = runCommand;

/** Error class plus Prisma/Node error code (P1001, ECONNRESET…); never messages, which can carry data. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? `${error.name} ${code}` : error.name;
}

/**
 * Retries a step that records a finished run. Claude often exits while the Mac
 * is asleep or in a brief maintenance wake with no network, and one failed
 * write would leave the row "running" until the stale sweep failed it.
 * Timers pause during sleep, so attempts × retryMs is awake time.
 */
export async function untilSaved<T>(
  fn: () => Promise<T>,
  options: { attempts: number; retryMs: number; onRetry?: (error: unknown, attempt: number) => void },
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= options.attempts) throw error;
      options.onRetry?.(error, attempt);
      await new Promise((done) => setTimeout(done, options.retryMs));
    }
  }
}
