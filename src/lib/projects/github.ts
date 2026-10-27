// GitHub repos for /projects, via the GraphQL API with GITHUB_TOKEN (a classic
// PAT with repo + read:org). Teammates push to the shared org repos, so a repo
// counts as "mine" only through commits I authored (GITHUB_IDENTITIES: logins
// and emails), never through its pushedAt.
//
// One sync is three steps:
//   1. List every repo the viewer can see, newest push first, until pushes
//      are older than 90 days (100 per page; cheap).
//   2. For those repos, the 10 most recently committed branches and each
//      branch's last 10 commits in 90 days, a few repos per aliased query.
//      (Asking for branches inside the repo listing timed out GitHub's 10 s
//      limit at 40 repos a page, so the two are split.)
//   3. tasks/todo.md at HEAD for repos active in 14 days or pinned.
//
// fetch is injectable, so everything below is unit-tested with a fake.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { companyFor } from "./company";
import { parseTodoPlan, type PlanItem } from "./todo-plan";

export const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

const DAY = 24 * 60 * 60 * 1000;
export const ACTIVE_DAYS = 14;
export const WINDOW_DAYS = 90;
const LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 20; // runaway-cursor guard
const HISTORY_BATCH = 8; // repos per branch-history query (~3 s each)
const PLAN_BATCH = 25; // repos per tasks/todo.md query
const CONCURRENCY = 3;
const COMMITS_KEPT = 5;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type RepoCommit = {
  oid: string;
  message: string;
  at: string;
  /** Branch the commit was found on; null when it is on the default branch. */
  branch: string | null;
  url: string;
};

/** Stored in ProjectSource.plan for repos. */
export type RepoPlan = { items: PlanItem[]; total: number };

export type RepoActivity = {
  key: string; // "owner/name"
  owner: string;
  name: string;
  description: string | null;
  url: string;
  homepageUrl: string | null;
  lastActivityAt: Date;
  commits: RepoCommit[];
};

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GithubError";
  }
}

export type GithubClient = {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
};

export function createGithubClient(opts: { token: string; fetch?: FetchLike; url?: string }): GithubClient {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  return {
    async graphql<T>(query: string, variables: Record<string, unknown> = {}) {
      const res = await doFetch(opts.url ?? GITHUB_GRAPHQL_URL, {
        method: "POST",
        headers: { Authorization: `bearer ${opts.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        throw new GithubError(
          res.status === 401 ? "GitHub rejected GITHUB_TOKEN (401)" : `GitHub GraphQL ${res.status}`,
          res.status,
        );
      }
      const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
      // Partial data (e.g. one aliased repo not found) is still usable.
      if (!body.data) throw new GithubError(`GitHub GraphQL error: ${body.errors?.[0]?.message ?? "no data"}`, 502);
      return body.data;
    },
  };
}

/** GITHUB_IDENTITIES (logins and emails, comma separated), lowercased. */
export function parseIdentities(raw: string | null | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// ---------------------------------------------------------------------------
// Step 1: repo listing

type RepoNode = {
  nameWithOwner: string;
  name: string;
  owner: { login: string };
  description: string | null;
  url: string;
  homepageUrl: string | null;
  pushedAt: string | null;
  isArchived: boolean;
  isFork: boolean;
  defaultBranchRef: { name: string } | null;
};

const LIST_QUERY = `query($after: String) {
  viewer {
    login
    repositories(first: ${LIST_PAGE_SIZE}, after: $after,
      affiliations: [OWNER, ORGANIZATION_MEMBER, COLLABORATOR],
      ownerAffiliations: [OWNER, ORGANIZATION_MEMBER, COLLABORATOR],
      orderBy: { field: PUSHED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        nameWithOwner name owner { login } description url homepageUrl
        pushedAt isArchived isFork defaultBranchRef { name }
      }
    }
  }
}`;

type ListData = {
  viewer: {
    login: string;
    repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RepoNode[] };
  };
};

/** Repos pushed within the window, minus archived repos and forks. */
export async function listRecentRepos(
  client: GithubClient,
  now: Date,
): Promise<{ viewer: string; scanned: number; repos: RepoNode[] }> {
  const cutoff = now.getTime() - WINDOW_DAYS * DAY;
  const repos: RepoNode[] = [];
  let viewer = "";
  let scanned = 0;
  let after: string | null = null;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const data: ListData = await client.graphql<ListData>(LIST_QUERY, { after });
    viewer = data.viewer.login;
    const { nodes, pageInfo } = data.viewer.repositories;
    let pastCutoff = false;
    for (const node of nodes) {
      if (!node.pushedAt || Date.parse(node.pushedAt) < cutoff) {
        pastCutoff = true;
        break;
      }
      scanned++;
      if (node.isArchived || node.isFork) continue;
      repos.push(node);
    }
    if (pastCutoff || !pageInfo.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }
  return { viewer, scanned, repos };
}

// ---------------------------------------------------------------------------
// Step 2: my commits per repo

type CommitNode = {
  oid: string;
  messageHeadline: string;
  committedDate: string;
  url: string;
  author: { email: string | null; user: { login: string } | null } | null;
};
type RefNode = { name: string; target: { history?: { nodes: CommitNode[] } } | null };
type HistoryRepo = { refs: { nodes: RefNode[] } } | null;

function historyQuery(repos: { owner: string; name: string }[]): string {
  const parts = repos.map(
    (r, i) => `r${i}: repository(owner: ${JSON.stringify(r.owner)}, name: ${JSON.stringify(r.name)}) {
    refs(first: 10, refPrefix: "refs/heads/", orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
      nodes { name target { ... on Commit { history(first: 10, since: $since) {
        nodes { oid messageHeadline committedDate url author { email user { login } } }
      } } } }
    }
  }`,
  );
  return `query($since: GitTimestamp!) {\n${parts.join("\n")}\n}`;
}

export function isMine(commit: CommitNode, identities: Set<string>): boolean {
  const login = commit.author?.user?.login?.toLowerCase();
  const email = commit.author?.email?.toLowerCase();
  return (!!login && identities.has(login)) || (!!email && identities.has(email));
}

/**
 * My commits across a repo's branches, deduped by oid (the default branch
 * wins the label), newest first, capped at five.
 */
export function myCommits(refs: RefNode[], defaultBranch: string | null, identities: Set<string>): RepoCommit[] {
  const ordered = [...refs].sort((a, b) => Number(b.name === defaultBranch) - Number(a.name === defaultBranch));
  const byOid = new Map<string, RepoCommit>();
  for (const ref of ordered) {
    for (const c of ref.target?.history?.nodes ?? []) {
      if (byOid.has(c.oid) || !isMine(c, identities)) continue;
      byOid.set(c.oid, {
        oid: c.oid,
        message: c.messageHeadline,
        at: c.committedDate,
        branch: ref.name === defaultBranch ? null : ref.name,
        url: c.url,
      });
    }
  }
  return [...byOid.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, COMMITS_KEPT);
}

async function inBatches<T, R>(items: T[], size: number, run: (batch: T[]) => Promise<R[]>): Promise<R[]> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  const out: R[][] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      out[i] = await run(batches[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return out.flat();
}

/** Repos with at least one of my commits in the window; the rest are dropped. */
export async function fetchMyRepoActivity(
  client: GithubClient,
  repos: RepoNode[],
  identities: Set<string>,
  now: Date,
): Promise<RepoActivity[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
  const found = await inBatches(repos, HISTORY_BATCH, async (batch) => {
    const data = await client.graphql<Record<string, HistoryRepo>>(
      historyQuery(batch.map((r) => ({ owner: r.owner.login, name: r.name }))),
      { since },
    );
    return batch.map((repo, i) => {
      const commits = myCommits(data[`r${i}`]?.refs.nodes ?? [], repo.defaultBranchRef?.name ?? null, identities);
      if (!commits.length) return null;
      return {
        key: repo.nameWithOwner,
        owner: repo.owner.login,
        name: repo.name,
        description: repo.description,
        url: repo.url,
        homepageUrl: repo.homepageUrl || null,
        lastActivityAt: new Date(commits[0].at),
        commits,
      } satisfies RepoActivity;
    });
  });
  return found.filter((r): r is RepoActivity => r !== null);
}

// ---------------------------------------------------------------------------
// Step 3: tasks/todo.md

/** tasks/todo.md text at HEAD per "owner/name" (null when the repo has none). */
export async function fetchTodoFiles(client: GithubClient, keys: string[]): Promise<Map<string, string | null>> {
  const pairs = await inBatches(keys, PLAN_BATCH, async (batch) => {
    const parts = batch.map((key, i) => {
      const [owner, name] = key.split("/");
      return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    object(expression: "HEAD:tasks/todo.md") { ... on Blob { text } }
  }`;
    });
    const data = await client.graphql<Record<string, { object: { text?: string | null } | null } | null>>(
      `query {\n${parts.join("\n")}\n}`,
    );
    return batch.map((key, i) => [key, data[`r${i}`]?.object?.text ?? null] as const);
  });
  return new Map(pairs);
}

// ---------------------------------------------------------------------------
// Sync

export type GithubSyncResult = {
  /** Repos pushed in 90 days that the viewer can see. */
  scanned: number;
  /** Repos with my commits in 90 days (rows written). */
  repos: number;
  /** Of those, active in 14 days. */
  active: number;
  ms: number;
};

export async function syncGithubProjects(
  userId: string,
  opts: { token?: string; fetch?: FetchLike; identities?: string; now?: Date } = {},
): Promise<GithubSyncResult> {
  const started = Date.now();
  const token = opts.token ?? process.env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_TOKEN not set");
  const now = opts.now ?? new Date();
  const client = createGithubClient({ token, fetch: opts.fetch });

  const { viewer, scanned, repos } = await listRecentRepos(client, now);
  const identities = parseIdentities(opts.identities ?? process.env.GITHUB_IDENTITIES);
  if (!identities.size && viewer) identities.add(viewer.toLowerCase());
  const mine = await fetchMyRepoActivity(client, repos, identities, now);

  const existing = await prisma.projectSource.findMany({
    where: { userId, kind: "repo" },
    select: { key: true, state: true },
  });
  const activeCutoff = now.getTime() - ACTIVE_DAYS * DAY;
  const active = mine.filter((r) => r.lastActivityAt.getTime() >= activeCutoff);
  const planKeys = new Set([...active.map((r) => r.key), ...existing.filter((e) => e.state === "pinned").map((e) => e.key)]);
  const todoFiles = planKeys.size ? await fetchTodoFiles(client, [...planKeys]) : new Map<string, string | null>();
  const planFor = (key: string): RepoPlan | undefined => {
    if (!todoFiles.has(key)) return undefined; // not fetched this run: keep the stored plan
    const text = todoFiles.get(key);
    return text ? parseTodoPlan(text) : { items: [], total: 0 };
  };

  for (const repo of mine) {
    const plan = planFor(repo.key);
    const data = {
      name: repo.name,
      description: repo.description,
      url: repo.url,
      homepageUrl: repo.homepageUrl,
      company: companyFor({ name: repo.name, owner: repo.owner }),
      lastActivityAt: repo.lastActivityAt,
      commits: repo.commits as unknown as Prisma.InputJsonValue,
      ...(plan ? { plan: plan as unknown as Prisma.InputJsonValue } : {}),
    };
    await prisma.projectSource.upsert({
      where: { userId_kind_key: { userId, kind: "repo", key: repo.key } },
      // state is the user's (pin / hide); a sync never touches it.
      create: { userId, kind: "repo", key: repo.key, state: "auto", ...data },
      update: data,
    });
  }
  // Pinned repos without recent commits of mine still get a fresh plan.
  for (const key of planKeys) {
    if (mine.some((r) => r.key === key)) continue;
    const plan = planFor(key);
    if (!plan) continue;
    await prisma.projectSource.updateMany({
      where: { userId, kind: "repo", key },
      data: { plan: plan as unknown as Prisma.InputJsonValue },
    });
  }

  return { scanned, repos: mine.length, active: active.length, ms: Date.now() - started };
}
