// Shared shape and limits for todo agent jobs (triage on Vercel, the Mac
// worker, and the /api/todos/[id]/agent route). Client-safe: no Prisma or
// Node imports.

export type AgentKind = "code" | "research" | "none";
export type AgentStatus = "queued" | "running" | "done" | "failed" | "skipped";

export const AGENT_KINDS: readonly AgentKind[] = ["code", "research", "none"];

/** Triage must be at least this sure before anything runs. */
export const MIN_CONFIDENCE = 0.75;
export const MAX_PLAN_CHARS = 500;
export const MAX_SUMMARY_CHARS = 2000;

export type AgentJobView = {
  id: string;
  todoId: string;
  kind: AgentKind;
  status: AgentStatus;
  confidence: number | null;
  plan: string | null;
  repo: string | null;
  branch: string | null;
  resultUrl: string | null;
  summary: string | null;
  error: string | null;
  costUsd: number | null;
  createdAt: string;
  completedAt: string | null;
};

export const AGENT_JOB_SELECT = {
  id: true,
  todoId: true,
  kind: true,
  status: true,
  confidence: true,
  plan: true,
  repo: true,
  branch: true,
  resultUrl: true,
  summary: true,
  error: true,
  costUsd: true,
  createdAt: true,
  completedAt: true,
} as const;

type JobRow = Omit<AgentJobView, "kind" | "status" | "createdAt" | "completedAt"> & {
  kind: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
};

export function toAgentJobView(row: JobRow): AgentJobView {
  return {
    ...row,
    kind: row.kind as AgentKind,
    status: row.status as AgentStatus,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export type AgentRepo = { name: string; description: string };

/**
 * AGENT_REPOS: "owner/name=what it is, owner/other=..." (description optional).
 * Only these repos can ever be touched; triage picks from them by description.
 */
export function parseAgentRepos(raw: string | undefined): AgentRepo[] {
  if (!raw) return [];
  const repos: AgentRepo[] = [];
  for (const part of raw.split(",")) {
    const [name, ...rest] = part.split("=");
    const trimmed = name?.trim() ?? "";
    if (!/^[\w.-]+\/[\w.-]+$/.test(trimmed)) continue;
    repos.push({ name: trimmed, description: rest.join("=").trim() });
  }
  return repos;
}

export function clip(text: string | null | undefined, max: number): string | null {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "agent/ab12cd-fix-the-login-form", safe for git and short enough for a PR. */
export function branchName(jobId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `agent/${jobId.slice(-6)}${slug ? `-${slug}` : ""}`;
}
