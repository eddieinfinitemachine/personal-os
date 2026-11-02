import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ updateMany: vi.fn() }));
// Never a real database from a unit test.
vi.mock("@prisma/client", () => ({ PrismaClient: class { constructor() { throw new Error("no database in tests"); } } }));
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Improvement } from "@prisma/client";
import {
  CHECK_DATABASE_URL, allowedEmails, branchName, keepAwake, parseGitHubRepo, parseWorkerFlags, prBody, prTitle,
  processImprovement, runProcess, slugify, timeoutMs, workerEnv, type Context,
} from "./improve-worker";

// Each test gets: a bare "GitHub" origin seeded with a tiny project, a clone of
// it as the worker's repo, and fake pnpm / gh / caffeinate / claude on PATH.
// git is real, so worktrees, rebases and pushes really happen.

const ID = "cmh5abcd0000test";
const REQUEST = "Make the research cards denser";
const BRANCH = `improve/cmh5abcd-make-the-research-cards-denser`;
const REAL_DB = "postgresql://real:secret@db.example.test/prod";

let root: string;
let logs: string;
let bin: string;
let origin: string;
let seed: string;
let repo: string;
let lines: string[];
let stop: (() => void) | null;

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.test",
};

function git(cwd: string, ...args: string[]): string {
  const env: Record<string, string> = { ...GIT_ENV, PATH: "/usr/bin:/bin", HOME: root };
  return execFileSync("git", args, { cwd, env: env as NodeJS.ProcessEnv, encoding: "utf8" });
}

function script(name: string, body: string) {
  const path = join(bin, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const FAKE_PNPM = `printf '%s|%s\\n' "$*" "\${DATABASE_URL:-}" >> "$LOG/pnpm.log"
case "$1" in
  install) exit 0 ;;
  typecheck|test|build)
    if [ "$FAIL_CHECK" = "$1" ]; then echo "src/a.ts(1,1): error TS2322: broken $1"; exit 1; fi
    exit 0 ;;
  exec) exit "\${DB_PUSH_EXIT:-0}" ;;
  *) echo "unexpected pnpm $*" >&2; exit 1 ;;
esac`;

// One line per call: newlines inside arguments (the PR body) become "~".
const FAKE_GH = `args=$(printf '%s ' "$@" | tr '\\n' '~')
printf '%s|%s\\n' "$PWD" "\${args% }" >> "$LOG/gh.log"
case "$1 $2" in
  "pr create") echo "Creating pull request..." >&2; echo "https://github.com/acme/app/pull/7" ;;
  "pr merge") exit "\${GH_MERGE_EXIT:-0}" ;;
  "pr view") echo '{"mergeCommit":{"oid":"abc1234def"}}' ;;
  api*)
    case "$2" in
      *"/deployments?sha="*) echo '[{"id":12,"environment":"Preview"},{"id":11,"environment":"Production"}]' ;;
      */deployments/11/statuses) echo "[{\\"state\\":\\"\${GH_PROD_STATE:-success}\\",\\"environment_url\\":\\"https://app.example.test\\"}]" ;;
      */deployments/12/statuses) echo '[{"state":"success","environment_url":"https://preview.example.test"}]' ;;
      *) echo '[]' ;;
    esac ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac`;

/** A fake claude: records its args, runs `body` in the worktree. */
function fakeClaude(body: string): string {
  return script("claude", `printf '%s\\n' "$@" > "$LOG/claude-args.txt"\n${body}`);
}

const result = (summary: string, risky = false, reason: string | null = null) =>
  `printf '%s' '${JSON.stringify({ summary, risky, riskReason: reason })}' > "$RESULT"`;
const DONE = `printf '{"type":"result","is_error":false,"result":"done","total_cost_usd":1.5}\\n'`;

const SAFE_CHANGE = `printf 'export const density = "compact";\\n' > src/feature.ts
git add -A && git commit -qm "feat(research): denser cards"
${result("Made the research cards denser. Open /research to see it.")}
${DONE}`;

const SCHEMA_CHANGE = `printf 'model Card { id String @id }\\n' >> prisma/schema.prisma
mkdir -p prisma/changes
printf 'CREATE TABLE IF NOT EXISTS "Card" ("id" TEXT PRIMARY KEY);\\n' > prisma/changes/20261102_card.sql
git add -A && git commit -qm "feat(research): card table"
${result("Adds a Card table.", true, "adds a table")}
${DONE}`;

function ctx(over: Partial<Context> = {}): Context {
  return {
    prisma: { improvement: { updateMany: mocks.updateMany } } as never,
    repoDir: repo,
    repo: "acme/app",
    worktreeRoot: join(root, "worktrees"),
    resultsRoot: join(root, "results"),
    claudeBin: join(bin, "claude"),
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, LOG: logs, RESULT: join(root, "results", ID, "result.json"), ...GIT_ENV },
    databaseUrl: REAL_DB,
    timeoutMs: 20_000,
    run: runProcess,
    keepAwake,
    registerStop: (fn) => { stop = fn; },
    log: (line) => lines.push(line),
    retryMs: 0,
    pollMs: 5,
    deployWaitMs: 200,
    previewWaitMs: 200,
    ...over,
  };
}

const withEnv = (extra: Record<string, string>): Partial<Context> => ({ env: { ...ctx().env, ...extra } });

const improvement = (over: Partial<Improvement> = {}) =>
  ({
    id: ID, userId: "u1", request: REQUEST, status: "running",
    context: { path: "/research", title: "Research", viewport: { width: 1440, height: 900 }, version: "0.312", userAgent: null },
    summary: null, reviewReason: null, branch: null, prUrl: null, previewUrl: null, mergedSha: null, error: null,
    ...over,
  }) as Improvement;

const worktree = () => join(root, "worktrees", "personal-os-improve-cmh5abcd");
const readLog = (name: string) => (existsSync(join(logs, name)) ? readFileSync(join(logs, name), "utf8") : "");
const ghCalls = () => readLog("gh.log").split("\n").filter(Boolean).map((line) => { const [cwd, ...rest] = line.split("|"); return { cwd, args: rest.join("|") }; });
const remoteBranches = () => git(origin, "for-each-ref", "--format=%(refname)", "refs/heads/improve/").trim();
const lastUpdate = () => mocks.updateMany.mock.calls.at(-1)![0];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
  root = realpathSync(mkdtempSync(join(tmpdir(), "improve-worker-test-")));
  logs = join(root, "logs");
  bin = join(root, "bin");
  origin = join(root, "origin.git");
  seed = join(root, "seed");
  repo = join(root, "repo");
  for (const dir of [logs, bin, seed]) mkdirSync(dir);
  lines = [];
  stop = null;
  script("pnpm", FAKE_PNPM);
  script("gh", FAKE_GH);
  script("caffeinate", `printf '%s\\n' "$*" >> "$LOG/caffeinate.log"\nexec sleep 30`);

  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(seed, "init", "-q", "-b", "main");
  mkdirSync(join(seed, "src"));
  mkdirSync(join(seed, "prisma/changes"), { recursive: true });
  writeFileSync(join(seed, "package.json"), '{"name":"app","private":true}\n');
  writeFileSync(join(seed, "src/app.ts"), 'export const title = "Research";\n');
  writeFileSync(join(seed, "prisma/schema.prisma"), "model Todo { id String @id }\n");
  writeFileSync(join(seed, ".gitignore"), "node_modules/\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "init");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, repo);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("improve worker flags, env and naming", () => {
  it("parses --once and rejects unknown flags", () => {
    expect(parseWorkerFlags(["--once"])).toEqual({ once: true });
    expect(() => parseWorkerFlags(["--nope"])).toThrow(/Unknown option/);
  });

  it("defaults the allowlist to the founder and the timeout to 40 minutes", () => {
    expect(allowedEmails({ FOUNDER_EMAIL: "Founder@Example.test" })).toEqual(["founder@example.test"]);
    expect(allowedEmails({ IMPROVE_ALLOWED_EMAILS: "a@x.test, b@x.test", FOUNDER_EMAIL: "c@x.test" })).toEqual(["a@x.test", "b@x.test"]);
    expect(timeoutMs({})).toBe(40 * 60_000);
    expect(timeoutMs({ IMPROVE_TIMEOUT_MIN: "5" })).toBe(5 * 60_000);
    expect(timeoutMs({ IMPROVE_TIMEOUT_MIN: "junk" })).toBe(40 * 60_000);
  });

  it("keeps database, Blob and production-build variables away from children", () => {
    const env = workerEnv({ PATH: "/usr/bin", HOME: "/h", DATABASE_URL: "x", DIRECT_URL: "x", BLOB_READ_WRITE_TOKEN: "x", VERCEL_ENV: "production" });
    expect(env).toMatchObject({ HOME: "/h" });
    for (const key of ["DATABASE_URL", "DIRECT_URL", "BLOB_READ_WRITE_TOKEN", "VERCEL_ENV"]) expect(env).not.toHaveProperty(key);
    expect(env.PATH).toContain("/opt/homebrew/bin");
  });

  it("names branches, titles and bodies", () => {
    expect(slugify("  Make the Research cards — dénser!! ")).toBe("make-the-research-cards-denser");
    expect(slugify("x".repeat(30) + " " + "y".repeat(30)).length).toBeLessThanOrEqual(40);
    expect(slugify("x".repeat(39) + " yy")).toBe("x".repeat(39));
    expect(slugify("🙂")).toBe("change");
    expect(branchName(ID, REQUEST)).toBe(BRANCH);
    expect(prTitle("\n  Fix the   sidebar\nmore detail")).toBe("Improve: Fix the sidebar");
    expect(prTitle("a".repeat(100))).toBe(`Improve: ${"a".repeat(69)}…`);
    const body = prBody({ request: "Ping @someone about ```code```", summary: "Done.", reasons: ["conflicts with main"] });
    expect(body).toContain("````text\nPing @someone about ```code```\n````");
    expect(body).toContain("## What changed\n\nDone.");
    expect(body).toContain("- conflicts with main");
    expect(body.endsWith("Opened by the Personal OS improve worker.")).toBe(true);
    expect(prBody({ request: "x", summary: null, reasons: [] })).not.toContain("Why it stopped");
  });

  it("reads owner/repo from https and ssh remotes", () => {
    expect(parseGitHubRepo("https://github.com/eddieinfinitemachine/personal-os.git\n")).toBe("eddieinfinitemachine/personal-os");
    expect(parseGitHubRepo("git@github.com:acme/app.git")).toBe("acme/app");
    expect(parseGitHubRepo("ssh://git@github.com/acme/app")).toBe("acme/app");
    expect(parseGitHubRepo("/tmp/origin.git")).toBeNull();
  });
});

describe("processImprovement: implement", () => {
  it("ships a safe change: checks, push, PR, squash merge, deploy confirmed, worktree removed", async () => {
    fakeClaude(SAFE_CHANGE);
    const outcome = await processImprovement(ctx(), { improvement: improvement(), kind: "implement" });
    expect(outcome).toBe("shipped");

    const args = readFileSync(join(logs, "claude-args.txt"), "utf8").split("\n");
    expect(args[0]).toBe("-p");
    expect(args).toContain("--disallowedTools");
    expect(args).toContain(`<request>`);

    // Checks ran with an unreachable database; nothing got the real one.
    expect(readLog("pnpm.log")).toBe([
      "install --frozen-lockfile --prefer-offline|",
      `typecheck|${CHECK_DATABASE_URL}`,
      `test|${CHECK_DATABASE_URL}`,
      `build|${CHECK_DATABASE_URL}`,
      "",
    ].join("\n"));

    const calls = ghCalls();
    const resultDir = join(root, "results", ID);
    for (const call of calls) expect(call.cwd).toBe(resultDir); // never inside a checkout
    expect(calls[0].args).toMatch(new RegExp(`^pr create --repo acme/app --base main --head ${BRANCH} --title Improve: ${REQUEST} --body `));
    expect(calls[0].args).toContain(`~\`\`\`text~${REQUEST}~\`\`\`~`);
    expect(calls[0].args).toContain("Made the research cards denser.");
    expect(calls[0].args.endsWith("~Opened by the Personal OS improve worker.")).toBe(true);
    const head = git(origin, "rev-parse", `refs/heads/${BRANCH}`).trim();
    expect(calls[1].args).toBe(`pr merge https://github.com/acme/app/pull/7 --repo acme/app --squash --delete-branch --match-head-commit ${head}`);
    expect(calls[2].args).toBe("pr view https://github.com/acme/app/pull/7 --repo acme/app --json mergeCommit");
    expect(calls[3].args).toBe("api repos/acme/app/deployments?sha=abc1234def");
    expect(calls[4].args).toBe("api repos/acme/app/deployments/11/statuses");

    // The pushed branch is the change on top of main.
    expect(git(origin, "log", "--format=%s", `refs/heads/${BRANCH}`).trim().split("\n")).toEqual(["feat(research): denser cards", "init"]);
    expect(existsSync(worktree())).toBe(false);
    expect(git(repo, "branch", "--list", "improve/*").trim()).toBe("");

    expect(mocks.updateMany.mock.calls[0][0]).toEqual({ where: { id: ID, status: "running" }, data: { branch: BRANCH, prUrl: "https://github.com/acme/app/pull/7" } });
    const update = lastUpdate();
    expect(update.where).toEqual({ id: ID, status: "running" });
    expect(update.data).toMatchObject({
      status: "shipped",
      summary: "Made the research cards denser. Open /research to see it.",
      prUrl: "https://github.com/acme/app/pull/7",
      branch: BRANCH,
      mergedSha: "abc1234def",
      error: null,
    });
    expect(update.data.completedAt).toBeInstanceOf(Date);

    expect(readLog("caffeinate.log").trim()).toBe(`-i -w ${process.pid}`);
    // Logs carry ids and statuses only.
    const log = lines.join("\n");
    expect(log).toContain(`Improve ${ID}: shipped (deploy success)`);
    expect(log).not.toMatch(/research cards|denser|improve\//i);
  });

  it("still ships, with a note, when the production deploy isn't confirmed in time", async () => {
    fakeClaude(SAFE_CHANGE);
    const outcome = await processImprovement(ctx(withEnv({ GH_PROD_STATE: "in_progress" })), { improvement: improvement(), kind: "implement" });
    expect(outcome).toBe("shipped");
    expect(lastUpdate().data.summary).toMatch(/to see it\. \(Deploy not confirmed within \d+ minutes\.\)$/);
  });

  it("stops a schema change at needs_review with its reasons and a preview link, then ships it once approved", async () => {
    fakeClaude(SCHEMA_CHANGE);
    const first = await processImprovement(ctx(), { improvement: improvement(), kind: "implement" });
    expect(first).toBe("needs_review");
    const review = lastUpdate().data;
    expect(review).toMatchObject({
      status: "needs_review",
      summary: "Adds a Card table.",
      reviewReason: "changes the database schema (prisma/); the agent flagged it: adds a table",
      branch: BRANCH,
      prUrl: "https://github.com/acme/app/pull/7",
      previewUrl: "https://preview.example.test",
    });
    expect(ghCalls().some((call) => call.args.startsWith("pr merge"))).toBe(false);
    expect(existsSync(worktree())).toBe(true);
    expect(readLog("pnpm.log")).not.toContain("exec");

    // Eddie taps "Ship it": the approved row comes back as kind "ship".
    rmSync(join(logs, "pnpm.log"));
    rmSync(join(logs, "gh.log"));
    mocks.updateMany.mockClear();
    const approved = improvement({ branch: BRANCH, prUrl: "https://github.com/acme/app/pull/7", summary: "Adds a Card table." });
    const second = await processImprovement(ctx(), { improvement: approved, kind: "ship" });
    expect(second).toBe("shipped");

    const pnpm = readLog("pnpm.log").split("\n").filter(Boolean);
    expect(pnpm).toEqual([
      "install --frozen-lockfile --prefer-offline|",
      `typecheck|${CHECK_DATABASE_URL}`,
      `test|${CHECK_DATABASE_URL}`,
      `build|${CHECK_DATABASE_URL}`,
      `exec prisma db execute --schema prisma/schema.prisma --file prisma/changes/20261102_card.sql|${REAL_DB}`,
    ]);
    expect(readLog("pnpm.log")).not.toContain("db push");
    const merge = ghCalls().find((call) => call.args.startsWith("pr merge"));
    expect(merge?.args).toMatch(/--repo acme\/app --squash --delete-branch --match-head-commit [0-9a-f]{40}$/);
    expect(lastUpdate().data).toMatchObject({ status: "shipped", summary: "Adds a Card table.", mergedSha: "abc1234def" });
    expect(existsSync(worktree())).toBe(false);
  });

  it("refuses to ship a schema change that has no prisma/changes SQL file", async () => {
    fakeClaude(`printf 'model Card { id String @id }\\n' >> prisma/schema.prisma
git add -A && git commit -qm "feat(research): card table"
${result("Adds a Card table.", true, "adds a table")}
${DONE}`);
    expect(await processImprovement(ctx(), { improvement: improvement(), kind: "implement" })).toBe("needs_review");
    rmSync(join(logs, "pnpm.log"));
    const approved = improvement({ branch: BRANCH, prUrl: "https://github.com/acme/app/pull/7", summary: "Adds a Card table." });
    expect(await processImprovement(ctx(), { improvement: approved, kind: "ship" })).toBe("failed");
    expect(lastUpdate().data.error).toMatch(/adds no prisma\/changes\/\*\.sql file/);
    expect(readLog("pnpm.log")).not.toContain("exec");
    expect(ghCalls().some((call) => call.args.startsWith("pr merge"))).toBe(false);
  });

  it("ships an approved change after its worktree is gone, rebased onto a newer main", async () => {
    fakeClaude(SCHEMA_CHANGE);
    expect(await processImprovement(ctx(), { improvement: improvement(), kind: "implement" })).toBe("needs_review");
    git(repo, "worktree", "remove", "--force", worktree());
    git(repo, "branch", "-D", BRANCH);
    writeFileSync(join(seed, "README.md"), "hello\n");
    git(seed, "add", "-A");
    git(seed, "commit", "-qm", "docs: readme");
    git(seed, "push", "-q", "origin", "main");

    const approved = improvement({ branch: BRANCH, prUrl: "https://github.com/acme/app/pull/7", summary: "Adds a Card table." });
    expect(await processImprovement(ctx(), { improvement: approved, kind: "ship" })).toBe("shipped");
    expect(git(origin, "log", "--format=%s", `refs/heads/${BRANCH}`).trim().split("\n")).toEqual(["feat(research): card table", "docs: readme", "init"]);
  });

  it("fails without pushing anything when a check fails", async () => {
    fakeClaude(SAFE_CHANGE);
    const outcome = await processImprovement(ctx(withEnv({ FAIL_CHECK: "typecheck" })), { improvement: improvement(), kind: "implement" });
    expect(outcome).toBe("failed");
    const update = lastUpdate();
    expect(update.data.status).toBe("failed");
    expect(update.data.error).toMatch(/^typecheck failed: .*TS2322: broken typecheck/);
    expect(readLog("pnpm.log")).not.toMatch(/^(test|build)\|/m);
    expect(remoteBranches()).toBe("");
    expect(readLog("gh.log")).toBe("");
    expect(existsSync(worktree())).toBe(false);
    expect(git(repo, "branch", "--list", BRANCH).trim()).toContain(BRANCH); // commits kept for a look
    expect(lines.join("\n")).toContain(`Improve ${ID}: failed (typecheck)`);
  });

  it("fails with the agent's explanation when no commit was made", async () => {
    fakeClaude(`${result("There is no research page with cards to change.")}\n${DONE}`);
    const outcome = await processImprovement(ctx(), { improvement: improvement(), kind: "implement" });
    expect(outcome).toBe("failed");
    expect(lastUpdate().data).toMatchObject({
      status: "failed",
      error: "No change was made. There is no research page with cards to change.",
      summary: "There is no research page with cards to change.",
    });
    expect(remoteBranches()).toBe("");
    expect(git(repo, "branch", "--list", "improve/*").trim()).toBe("");
  });

  it("fails a change left uncommitted", async () => {
    fakeClaude(`printf 'x\\n' > src/loose.ts\n${result("Did it.")}\n${DONE}`);
    expect(await processImprovement(ctx(), { improvement: improvement(), kind: "implement" })).toBe("failed");
    expect(lastUpdate().data.error).toBe("No change was made. Did it.");
    fakeClaude(`printf 'x\\n' > src/a.ts && git add -A && git commit -qm "feat: a"\nprintf 'y\\n' > src/loose.ts\n${result("Did it.")}\n${DONE}`);
    expect(await processImprovement(ctx(), { improvement: improvement(), kind: "implement" })).toBe("failed");
    expect(lastUpdate().data.error).toBe("Claude left uncommitted changes. Did it.");
    expect(remoteBranches()).toBe("");
  });

  it("kills a run that exceeds the timeout, including its children", async () => {
    fakeClaude("sleep 30 & wait");
    const started = Date.now();
    const outcome = await processImprovement(ctx({ timeoutMs: 300 }), { improvement: improvement(), kind: "implement" });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(outcome).toBe("failed");
    expect(lastUpdate().data.error).toMatch(/^Timed out after/);
    expect(remoteBranches()).toBe("");
  });

  it("opens a PR for review without running checks when the change conflicts with main", async () => {
    // main moves on while Claude works, changing the same line.
    writeFileSync(join(seed, "src/app.ts"), 'export const title = "Reports";\n');
    git(seed, "commit", "-qam", "feat: rename");
    fakeClaude(`printf 'export const title = "Research!";\\n' > src/app.ts
git add -A && git commit -qm "feat(research): louder title"
git -C "${seed}" push -q origin main
${result("Louder title.")}
${DONE}`);
    const outcome = await processImprovement(ctx(), { improvement: improvement(), kind: "implement" });
    expect(outcome).toBe("needs_review");
    expect(lastUpdate().data).toMatchObject({ status: "needs_review", reviewReason: "conflicts with main", prUrl: "https://github.com/acme/app/pull/7" });
    expect(readLog("pnpm.log")).not.toMatch(/typecheck|build/);
    expect(ghCalls()[0].args).toMatch(/^pr create /);
    expect(ghCalls().some((call) => call.args.startsWith("pr merge"))).toBe(false);
    expect(remoteBranches()).toBe(`refs/heads/${BRANCH}`);
    expect(git(worktree(), "status", "--porcelain").trim()).toBe(""); // the rebase was aborted cleanly
  });

  it("fails an approved change that no longer rebases onto main", async () => {
    fakeClaude(`printf 'export const title = "Research!";\\n' > src/app.ts
git add -A && git commit -qm "feat(research): louder title"
${result("Louder title.", true, "test")}
${DONE}`);
    expect(await processImprovement(ctx(), { improvement: improvement(), kind: "implement" })).toBe("needs_review");
    writeFileSync(join(seed, "src/app.ts"), 'export const title = "Reports";\n');
    git(seed, "commit", "-qam", "feat: rename");
    git(seed, "push", "-q", "origin", "main");
    const approved = improvement({ branch: BRANCH, prUrl: "https://github.com/acme/app/pull/7" });
    expect(await processImprovement(ctx(), { improvement: approved, kind: "ship" })).toBe("failed");
    expect(lastUpdate().data).toMatchObject({ status: "failed", error: "conflicts with main; resolve the PR by hand" });
    expect(ghCalls().some((call) => call.args.startsWith("pr merge"))).toBe(false);
  });

  it("refuses to ship a row without an improve branch", async () => {
    const approved = improvement({ branch: "main", prUrl: "https://github.com/acme/app/pull/7" });
    expect(await processImprovement(ctx(), { improvement: approved, kind: "ship" })).toBe("failed");
    expect(lastUpdate().data.error).toMatch(/^Nothing to ship/);
    expect(readLog("gh.log")).toBe("");
  });

  it("puts the job back in the queue and removes its worktree when the worker stops mid-run", async () => {
    fakeClaude("sleep 30 & wait");
    const run = processImprovement(ctx(), { improvement: improvement(), kind: "implement" });
    await vi.waitFor(() => expect(existsSync(join(logs, "claude-args.txt"))).toBe(true), { timeout: 10_000 });
    stop!();
    expect(await run).toBe("requeued");
    expect(lastUpdate()).toEqual({ where: { id: ID, status: "running" }, data: { status: "queued", startedAt: null } });
    expect(existsSync(worktree())).toBe(false);
    expect(git(repo, "branch", "--list", "improve/*").trim()).toBe("");
  });

  it("leaves the pull request open, unmerged, when the row was deleted while it ran", async () => {
    fakeClaude(SAFE_CHANGE);
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect(await processImprovement(ctx(), { improvement: improvement(), kind: "implement" })).toBe("failed");
    expect(ghCalls().map((call) => call.args.split(" ").slice(0, 2).join(" "))).toEqual(["pr create"]);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it("retries saving the outcome while the database is unreachable, logging codes only", async () => {
    fakeClaude(SAFE_CHANGE);
    const offline = Object.assign(new Error("Can't reach database server at db.example.test"), { name: "PrismaClientKnownRequestError", code: "P1001" });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(offline);
    expect(await processImprovement(ctx(), { improvement: improvement(), kind: "implement" })).toBe("shipped");
    expect(mocks.updateMany).toHaveBeenCalledTimes(3);
    expect(lastUpdate().data.status).toBe("shipped");
    expect(lines).toContain(`Improve ${ID}: saving the shipped change failed (PrismaClientKnownRequestError P1001); retrying`);
    expect(lines.join("\n")).not.toContain("Can't reach");
  });
});
