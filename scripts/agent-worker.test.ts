import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ updateMany: vi.fn(), todoFindUnique: vi.fn(), commentCreate: vi.fn() }));
// Never a real database from a unit test.
vi.mock("@prisma/client", () => ({ PrismaClient: class { constructor() { throw new Error("no database in tests"); } } }));
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentJob } from "@prisma/client";
import { allowedEmails, dailyBudgetUsd, parseWorkerFlags, processJob, timeoutMs, type Context } from "./agent-worker";

let root: string;
let origin: string;
let stop: (() => void) | null;
let notified: string[];

const sh = (cwd: string, cmd: string, ...args: string[]) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x.test" } }).trim();

/** A bare "origin" with one commit on main, like GitHub would serve. */
function makeOrigin(): string {
  const seed = join(root, "seed");
  mkdirSync(seed);
  sh(seed, "git", "init", "-q", "-b", "main");
  sh(seed, "git", "config", "user.email", "t@x.test");
  sh(seed, "git", "config", "user.name", "t");
  writeFileSync(join(seed, "README.md"), "# demo\n");
  sh(seed, "git", "add", ".");
  sh(seed, "git", "commit", "-q", "-m", "init");
  const bare = join(root, "origin.git");
  sh(root, "git", "clone", "-q", "--bare", seed, bare);
  sh(bare, "git", "symbolic-ref", "HEAD", "refs/heads/main");
  return bare;
}

function fakeClaude(body: string): string {
  const bin = join(root, "fake-claude.sh");
  // $PWD is the repo clone; the job dir is the last argument's "jobDir" line, so read it from the prompt.
  writeFileSync(bin, `#!/bin/sh
printf '%s\\n' "$@" > "${root}/args.txt"
JOBDIR=$(grep -o '[^ ]*/jobs/[^/ ]*' "${root}/args.txt" | head -1)
${body}
printf '{"type":"result","is_error":false,"result":"done","total_cost_usd":1.25}\\n'
`);
  chmodSync(bin, 0o755);
  return bin;
}

function fakeGh(body = `printf 'https://github.com/eddie/demo/pull/7\\n'`): string {
  const bin = join(root, "fake-gh.sh");
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${root}/gh-args.txt"\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const COMMIT_AND_SUMMARY = `git config user.email t@x.test && git config user.name t
printf 'hello\\n' > feature.txt
git add feature.txt
git commit -q -m "feat: add feature"
printf 'Added feature.txt.\\nChecked: nothing to run.\\n' > "$JOBDIR/summary.txt"`;

function ctx(bin: string, over: Partial<Context> = {}): Context {
  return {
    prisma: {
      agentJob: { updateMany: mocks.updateMany },
      todo: { findUnique: mocks.todoFindUnique },
      comment: { create: mocks.commentCreate },
    } as never,
    bin,
    ghBin: fakeGh(),
    env: { PATH: process.env.PATH, HOME: root },
    timeoutMs: 20_000,
    root,
    allowedRepos: ["eddie/demo"],
    repoUrl: () => origin,
    registerStop: (fn) => { stop = fn; },
    log: () => {},
    notify: async (text) => { notified.push(text); },
    ...over,
  };
}

const job = { id: "cljob000001", userId: "u1", todoId: "t1", kind: "code", status: "running", repo: "eddie/demo", plan: "Add the thing." } as AgentJob;

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), "agent-worker-test-"));
  origin = makeOrigin();
  stop = null;
  notified = [];
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.todoFindUnique.mockResolvedValue({ title: "Add a feature file", notes: "Just a hello." });
  mocks.commentCreate.mockResolvedValue({});
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("agent worker flags and env", () => {
  it("parses --once and rejects unknown flags", () => {
    expect(parseWorkerFlags([])).toEqual({ once: false });
    expect(parseWorkerFlags(["--once"])).toEqual({ once: true });
    expect(() => parseWorkerFlags(["--nope"])).toThrow(/Unknown option/);
  });

  it("defaults the allowlist to the founder, the timeout to 60 minutes and the budget to $25", () => {
    expect(allowedEmails({ FOUNDER_EMAIL: "Founder@Example.test" })).toEqual(["founder@example.test"]);
    expect(allowedEmails({ AGENT_ALLOWED_EMAILS: "a@x.test, b@x.test", FOUNDER_EMAIL: "c@x.test" })).toEqual(["a@x.test", "b@x.test"]);
    expect(timeoutMs({})).toBe(60 * 60_000);
    expect(timeoutMs({ AGENT_TIMEOUT_MIN: "5" })).toBe(5 * 60_000);
    expect(dailyBudgetUsd({})).toBe(25);
    expect(dailyBudgetUsd({ AGENT_DAILY_BUDGET_USD: "0" })).toBe(0);
    expect(dailyBudgetUsd({ AGENT_DAILY_BUDGET_USD: "junk" })).toBe(25);
  });
});

describe("processJob", () => {
  it("clones the repo, runs claude on a fresh branch, pushes, opens the PR and records it", async () => {
    const result = await processJob(ctx(fakeClaude(COMMIT_AND_SUMMARY)), job);
    expect(result).toBe("done");

    const args = readFileSync(join(root, "args.txt"), "utf8");
    expect(args.startsWith("-p\n")).toBe(true);
    expect(args).toContain("<todo>\nAdd a feature file\n\nJust a hello.\n</todo>");
    expect(args).toContain("Triage's reading of it: Add the thing.");
    expect(args).toContain("--permission-mode\nbypassPermissions\n--output-format\njson");

    // The branch reached the origin with the commit.
    const branch = "agent/000001-add-a-feature-file";
    expect(sh(origin, "git", "rev-list", "--count", `main..${branch}`)).toBe("1");

    const ghArgs = readFileSync(join(root, "gh-args.txt"), "utf8").split("\n");
    expect(ghArgs.slice(0, 8)).toEqual(["pr", "create", "--repo", "eddie/demo", "--head", branch, "--base", "main"]);
    expect(ghArgs[ghArgs.indexOf("--title") + 1]).toBe("Add a feature file");
    expect(ghArgs.join("\n")).toContain("Added feature.txt.");

    const final = mocks.updateMany.mock.calls.at(-1)![0];
    expect(final.where).toEqual({ id: "cljob000001", status: "running" });
    expect(final.data).toMatchObject({ status: "done", resultUrl: "https://github.com/eddie/demo/pull/7", costUsd: 1.25, summary: "Added feature.txt. Checked: nothing to run." });
    expect(mocks.updateMany.mock.calls[0][0]).toEqual({ where: { id: "cljob000001" }, data: { branch } });
    expect(mocks.commentCreate.mock.calls[0][0].data).toMatchObject({ todoId: "t1", authorId: "u1" });
    expect(mocks.commentCreate.mock.calls[0][0].data.body).toContain("https://github.com/eddie/demo/pull/7");
    expect(notified[0]).toContain("Started: *Add a feature file*");
    expect(notified[1]).toContain("PR ready");
  });

  it("reuses the clone and starts each job from a clean default branch", async () => {
    await processJob(ctx(fakeClaude(COMMIT_AND_SUMMARY)), job);
    const clone = join(root, "repos", "eddie__demo");
    writeFileSync(join(clone, "leftover.txt"), "junk");
    const second = await processJob(ctx(fakeClaude(COMMIT_AND_SUMMARY)), { ...job, id: "cljob000002" });
    expect(second).toBe("done");
    expect(existsSync(join(clone, "leftover.txt"))).toBe(false);
    expect(sh(origin, "git", "rev-list", "--count", "main..agent/000002-add-a-feature-file")).toBe("1");
  });

  it("marks the job done without a PR when claude commits nothing but explains", async () => {
    const result = await processJob(ctx(fakeClaude(`printf 'No change needed: already done on main.\\n' > "$JOBDIR/summary.txt"`)), job);
    expect(result).toBe("done");
    expect(existsSync(join(root, "gh-args.txt"))).toBe(false);
    const final = mocks.updateMany.mock.calls.at(-1)![0];
    expect(final.data).toMatchObject({ status: "done", resultUrl: null, summary: "No change needed: already done on main." });
    expect(mocks.commentCreate.mock.calls[0][0].data.body).toContain("made no change");
    expect(notified[1]).toContain("No change");
  });

  it("fails when claude exits without a summary", async () => {
    const result = await processJob(ctx(fakeClaude(":")), job);
    expect(result).toBe("failed");
    const final = mocks.updateMany.mock.calls.at(-1)![0];
    expect(final.data.status).toBe("failed");
    expect(final.data.error).toContain("without summary.txt");
    expect(final.data.costUsd).toBe(1.25);
    expect(notified[1]).toContain("Failed");
  });

  it("fails when the PR cannot be opened, keeping the branch and summary", async () => {
    const c = ctx(fakeClaude(COMMIT_AND_SUMMARY));
    c.ghBin = fakeGh("echo 'auth required' >&2; exit 4");
    const result = await processJob(c, job);
    expect(result).toBe("failed");
    const final = mocks.updateMany.mock.calls.at(-1)![0];
    expect(final.data).toMatchObject({ status: "failed", summary: "Added feature.txt. Checked: nothing to run." });
    expect(final.data.error).toContain("could not open the PR");
  });

  it("refuses repos outside AGENT_REPOS and todos that are gone", async () => {
    expect(await processJob(ctx(fakeClaude(COMMIT_AND_SUMMARY)), { ...job, repo: "someone/else" })).toBe("failed");
    expect(mocks.updateMany.mock.calls.at(-1)![0].data.error).toContain("not in AGENT_REPOS");
    mocks.todoFindUnique.mockResolvedValueOnce(null);
    expect(await processJob(ctx(fakeClaude(COMMIT_AND_SUMMARY)), job)).toBe("failed");
    expect(existsSync(join(root, "args.txt"))).toBe(false);
  });

  it("times out a stuck run and marks it failed", async () => {
    const result = await processJob(ctx(fakeClaude("sleep 30"), { timeoutMs: 500 }), job);
    expect(result).toBe("failed");
    expect(mocks.updateMany.mock.calls.at(-1)![0].data.error).toContain("Timed out");
  });

  it("requeues the job when the worker is asked to stop mid-run", async () => {
    const promise = processJob(ctx(fakeClaude("sleep 30")), job);
    await vi.waitFor(() => { if (!stop) throw new Error("not started"); });
    stop!();
    expect(await promise).toBe("requeued");
    expect(mocks.updateMany.mock.calls.at(-1)![0]).toEqual({ where: { id: "cljob000001", status: "running" }, data: { status: "queued", startedAt: null } });
  });
});
