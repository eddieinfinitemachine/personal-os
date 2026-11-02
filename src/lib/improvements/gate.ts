// The improve worker's risk gate: decides whether a checked change may
// auto-merge or must stop at a pull request for Eddie's one-tap approval.
// Pure; the worker feeds it `git diff` output and the agent's own verdict.

export type DiffFile = { path: string; added: number; deleted: number };
export type AddedLine = { path: string; line: string };
export type RiskInput = { files: DiffFile[]; addedLines: AddedLine[]; agentRisky: boolean; agentReason: string | null };
export type RiskAssessment = { risky: boolean; reasons: string[] };

export const MAX_CHANGED_LINES = 800;

const SENSITIVE_PATHS: { match: (path: string) => boolean; reason: string }[] = [
  { match: (p) => p.startsWith("prisma/"), reason: "changes the database schema (prisma/)" },
  {
    match: (p) => p === "src/middleware.ts" || p === "src/proxy.ts" || p.startsWith("src/lib/auth") || p.startsWith("src/app/login/") || p.startsWith("src/app/api/auth/"),
    reason: "changes sign-in or auth",
  },
  { match: (p) => p === "package.json" || p === "pnpm-lock.yaml", reason: "changes dependencies (package.json, pnpm-lock.yaml)" },
  { match: (p) => p === "vercel.json" || p.startsWith("next.config."), reason: "changes the build or deploy config" },
  { match: (p) => p.startsWith("scripts/launchagents/"), reason: "changes a Mac LaunchAgent" },
  {
    // The dialog's UI (src/components/improve/) is fine to auto-ship; the machinery is not.
    match: (p) => p === "scripts/improve-worker.ts" || p.startsWith("scripts/lib/") || p.startsWith("src/lib/improvements/") || p.startsWith("src/app/api/improvements/"),
    reason: "changes the improve worker itself",
  },
];

const isTestFile = (path: string) => /\.test\.tsx?$/.test(path);

/** Prisma deletes on a client-like receiver; Map/Set/URLSearchParams `.delete(` never match. */
const PRISMA_DELETE = /\b(?:prisma|tx|db|client)\.\w+\.delete(?:Many)?\s*\(/;
const SQL_DROP = /\bDROP\s+(?:TABLE|COLUMN|INDEX|SCHEMA|DATABASE)\b/i;
// Uppercase, or "truncate table": Tailwind's lowercase `truncate` class is everywhere.
const SQL_TRUNCATE = [/\bTRUNCATE\b/, /\btruncate\s+table\b/i];
// Uppercase only, so UI copy like "Delete from list" passes.
const SQL_DELETE_FROM = /\bDELETE\s+FROM\b/;

const destructiveLine = (line: string) =>
  [PRISMA_DELETE, SQL_DROP, ...SQL_TRUNCATE, SQL_DELETE_FROM].some((pattern) => pattern.test(line));

export function assessRisk(input: RiskInput): RiskAssessment {
  const reasons = new Set<string>();
  for (const { path } of input.files) {
    for (const rule of SENSITIVE_PATHS) if (rule.match(path)) reasons.add(rule.reason);
  }
  if (input.addedLines.some(({ path, line }) => !isTestFile(path) && destructiveLine(line))) {
    reasons.add("adds code that deletes or drops data");
  }
  const changed = input.files.reduce((sum, file) => sum + file.added + file.deleted, 0);
  if (changed > MAX_CHANGED_LINES) reasons.add(`changes ${changed} lines (over ${MAX_CHANGED_LINES})`);
  if (input.agentRisky) {
    const why = input.agentReason?.replace(/\s+/g, " ").trim().slice(0, 300);
    reasons.add(why ? `the agent flagged it: ${why}` : "the agent flagged it as risky");
  }
  return { risky: reasons.size > 0, reasons: [...reasons] };
}

/** `git diff --numstat --no-renames` (with or without -z) → files; binary files ("-\t-\tpath") count as 0 lines. */
export function parseNumstat(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const row of text.split(/[\n\0]/)) {
    const match = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(row);
    if (!match) continue;
    files.push({ path: match[3], added: Number(match[1]) || 0, deleted: Number(match[2]) || 0 });
  }
  return files;
}

/** Added lines of `git diff -U0 --no-renames`, with the file each belongs to. */
export function parseAddedLines(diff: string): AddedLine[] {
  const lines: AddedLine[] = [];
  let path = "";
  let inHunk = false;
  for (const row of diff.split("\n")) {
    if (row.startsWith("diff --git ")) {
      inHunk = false;
      path = "";
    } else if (!inHunk && row.startsWith("+++ ")) {
      const target = row.slice(4);
      path = target === "/dev/null" ? "" : target.replace(/^b\//, "");
    } else if (row.startsWith("@@")) {
      inHunk = true;
    } else if (inHunk && row.startsWith("+")) {
      lines.push({ path, line: row.slice(1) });
    }
  }
  return lines;
}
