import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { projectSource: { findMany: mocks.findMany, upsert: mocks.upsert, updateMany: mocks.updateMany } },
}));
import { myCommits, parseIdentities, syncGithubProjects } from "./github";

const NOW = new Date("2026-10-27T18:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400_000).toISOString();
const IDS = "eddieinfinitemachine,edcohen,eddie@infinitemachine.com,eddiemc27@mac.com";

type Commit = { oid: string; messageHeadline: string; committedDate: string; url: string; author: { email: string; user: { login: string } | null } };
const commit = (oid: string, at: string, login: string | null, email: string, msg = `commit ${oid}`): Commit => ({
  oid,
  messageHeadline: msg,
  committedDate: at,
  url: `https://github.com/x/y/commit/${oid}`,
  author: { email, user: login ? { login } : null },
});
const ref = (name: string, commits: Commit[]) => ({ name, target: { history: { nodes: commits } } });

type Repo = {
  nameWithOwner: string;
  pushedAt: string;
  isArchived?: boolean;
  isFork?: boolean;
  defaultBranch?: string;
  refs: ReturnType<typeof ref>[];
  todo?: string | null;
};

const repoNode = (r: Repo) => {
  const [owner, name] = r.nameWithOwner.split("/");
  return {
    nameWithOwner: r.nameWithOwner,
    name,
    owner: { login: owner },
    description: `${name} description`,
    url: `https://github.com/${r.nameWithOwner}`,
    homepageUrl: "",
    pushedAt: r.pushedAt,
    isArchived: !!r.isArchived,
    isFork: !!r.isFork,
    defaultBranchRef: { name: r.defaultBranch ?? "main" },
  };
};

/** A fake GraphQL endpoint over `repos`, paging the listing `pageSize` at a time. */
function fakeGithub(repos: Repo[], pageSize = 100) {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    calls.push({ query, variables });
    const aliases = [...query.matchAll(/(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)];
    let data: unknown;
    if (query.includes("viewer")) {
      const start = variables.after ? Number(variables.after) : 0;
      const nodes = repos.slice(start, start + pageSize).map(repoNode);
      const next = start + pageSize < repos.length;
      data = {
        viewer: {
          login: "eddieinfinitemachine",
          repositories: { pageInfo: { hasNextPage: next, endCursor: next ? String(start + pageSize) : null }, nodes },
        },
      };
    } else if (query.includes("HEAD:tasks/todo.md")) {
      data = Object.fromEntries(
        aliases.map(([, alias, owner, name]) => {
          const r = repos.find((x) => x.nameWithOwner === `${owner}/${name}`);
          return [alias, { object: r?.todo ? { text: r.todo } : null }];
        }),
      );
    } else {
      data = Object.fromEntries(
        aliases.map(([, alias, owner, name]) => {
          const r = repos.find((x) => x.nameWithOwner === `${owner}/${name}`);
          return [alias, r ? { refs: { nodes: r.refs } } : null];
        }),
      );
    }
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  return { fetch, calls };
}

// Real shape from the Infinite-Machine/service-and-troubleshooting probe:
// every commit is a teammate's (and one by the claude bot).
const TEAMMATE_ONLY: Repo = {
  nameWithOwner: "Infinite-Machine/service-and-troubleshooting",
  pushedAt: daysAgo(0.1),
  refs: [
    ref("main", [
      commit("k1", daysAgo(0.2), "kennyinfinitemachine", "kenny@infinitemachine.com", "Size notes to the case (#9)"),
      commit("k2", daysAgo(0.3), "kennyinfinitemachine", "kenny@infinitemachine.com"),
    ]),
    ref("issues-8d-restructure", [commit("c1", daysAgo(1), "claude", "noreply@anthropic.com")]),
  ],
  todo: "- [ ] not mine",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.upsert.mockResolvedValue({});
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

const upserted = () => mocks.upsert.mock.calls.map((c) => c[0]);

describe("syncGithubProjects", () => {
  it("writes no row for a repo with only teammates' commits", async () => {
    const { fetch } = fakeGithub([TEAMMATE_ONLY]);
    const res = await syncGithubProjects("u1", { token: "t", fetch, identities: IDS, now: NOW });
    expect(res).toMatchObject({ scanned: 1, repos: 0, active: 0 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("counts my commits by login (edcohen) or by email alone, dedupes across branches, keeps 5 newest", async () => {
    const shared = commit("s1", daysAgo(1), "edcohen", "eddiemc27@mac.com", "Shared commit");
    const { fetch } = fakeGithub([
      {
        nameWithOwner: "edcohen/rushmore",
        pushedAt: daysAgo(1),
        refs: [
          ref("feature/x", [shared, commit("f1", daysAgo(2), null, "EDDIE@infinitemachine.com", "Email only")]),
          ref("main", [shared, ...[3, 4, 5, 6, 7].map((d) => commit(`m${d}`, daysAgo(d), "edcohen", "x@y.z"))]),
        ],
        todo: "# Now\n- [ ] Ship it\n- [x] Done",
      },
    ]);
    await syncGithubProjects("u1", { token: "t", fetch, identities: IDS, now: NOW });
    const row = upserted()[0];
    const commits = row.create.commits as { oid: string; branch: string | null }[];
    expect(commits.map((c) => c.oid)).toEqual(["s1", "f1", "m3", "m4", "m5"]);
    // Found on both branches: labelled with the default branch (null).
    expect(commits[0].branch).toBeNull();
    expect(commits[1].branch).toBe("feature/x");
    expect(row.create.lastActivityAt).toEqual(new Date(daysAgo(1)));
    expect(row.create.plan).toEqual({ items: [{ text: "Ship it", section: "Now" }], total: 1 });
    expect(row.create.company).toBe("Personal");
  });

  it("defaults identities to the viewer's login", async () => {
    vi.stubEnv("GITHUB_IDENTITIES", "");
    const { fetch } = fakeGithub([
      {
        nameWithOwner: "Infinite-Machine/im-app",
        pushedAt: daysAgo(1),
        refs: [ref("main", [commit("a", daysAgo(1), "eddieinfinitemachine", "x@x.x"), commit("b", daysAgo(1), "edcohen", "y@y.y")])],
      },
    ]);
    await syncGithubProjects("u1", { token: "t", fetch, now: NOW });
    expect((upserted()[0].create.commits as { oid: string }[]).map((c) => c.oid)).toEqual(["a"]);
    vi.unstubAllEnvs();
  });

  it("stops paging at the 90-day cutoff and skips archived repos and forks", async () => {
    const mine = (oid: string) => [ref("main", [commit(oid, daysAgo(5), "edcohen", "")])];
    const repos: Repo[] = [
      { nameWithOwner: "edcohen/a", pushedAt: daysAgo(1), refs: mine("a") },
      { nameWithOwner: "edcohen/archived", pushedAt: daysAgo(2), isArchived: true, refs: mine("b") },
      { nameWithOwner: "edcohen/fork", pushedAt: daysAgo(3), isFork: true, refs: mine("c") },
      { nameWithOwner: "edcohen/d", pushedAt: daysAgo(80), refs: mine("d") },
      { nameWithOwner: "edcohen/old", pushedAt: daysAgo(91), refs: mine("e") },
      { nameWithOwner: "edcohen/older", pushedAt: daysAgo(200), refs: mine("f") },
    ];
    const { fetch, calls } = fakeGithub(repos, 2);
    const res = await syncGithubProjects("u1", { token: "t", fetch, identities: IDS, now: NOW });
    // Pages: [a, archived], [fork, d], [old, …] → stops at "old" and never asks for page 4.
    expect(calls.filter((c) => c.query.includes("viewer"))).toHaveLength(3);
    expect(res.scanned).toBe(4);
    const historyQueries = calls.filter((c) => c.query.includes("refs(")).map((c) => c.query).join("\n");
    expect(historyQueries).toContain('name: "a"');
    expect(historyQueries).toContain('name: "d"');
    expect(historyQueries).not.toContain('name: "archived"');
    expect(historyQueries).not.toContain('name: "fork"');
    expect(historyQueries).not.toContain('name: "old"');
    expect(upserted().map((u) => u.create.key)).toEqual(["edcohen/a", "edcohen/d"]);
  });

  it("fetches plans only for repos active in 14 days or pinned, and never overwrites state", async () => {
    mocks.findMany.mockResolvedValue([
      { key: "edcohen/dormant-pinned", state: "pinned" },
      { key: "edcohen/active", state: "hidden" },
    ]);
    const { fetch, calls } = fakeGithub([
      { nameWithOwner: "edcohen/active", pushedAt: daysAgo(1), refs: [ref("main", [commit("a", daysAgo(1), "edcohen", "")])], todo: "- [ ] A" },
      { nameWithOwner: "edcohen/dormant", pushedAt: daysAgo(30), refs: [ref("main", [commit("b", daysAgo(30), "edcohen", "")])], todo: "- [ ] B" },
      { nameWithOwner: "edcohen/dormant-pinned", pushedAt: daysAgo(40), refs: [ref("main", [commit("c", daysAgo(40), "edcohen", "")])], todo: "- [ ] C" },
    ]);
    const res = await syncGithubProjects("u1", { token: "t", fetch, identities: IDS, now: NOW });
    expect(res).toMatchObject({ repos: 3, active: 1 });
    const planQuery = calls.find((c) => c.query.includes("HEAD:tasks/todo.md"))!.query;
    expect(planQuery).toContain('name: "active"');
    expect(planQuery).toContain('name: "dormant-pinned"');
    expect(planQuery).not.toContain('name: "dormant")');
    const byKey = Object.fromEntries(upserted().map((u) => [u.create.key, u]));
    for (const u of upserted()) {
      expect(u.create.state).toBe("auto");
      expect(u.update).not.toHaveProperty("state");
    }
    expect(byKey["edcohen/active"].update.plan).toEqual({ items: [{ text: "A", section: null }], total: 1 });
    // Dormant and not pinned: the stored plan is left alone.
    expect(byKey["edcohen/dormant"].update).not.toHaveProperty("plan");
    expect(byKey["edcohen/dormant-pinned"].update.plan).toEqual({ items: [{ text: "C", section: null }], total: 1 });
  });

  it("files repos by company rules", async () => {
    const { fetch } = fakeGithub([
      { nameWithOwner: "Infinite-Machine/olto-site", pushedAt: daysAgo(1), refs: [ref("main", [commit("a", daysAgo(1), "edcohen", "")])] },
      { nameWithOwner: "Infinite-Machine/fleet", pushedAt: daysAgo(1), refs: [ref("main", [commit("b", daysAgo(1), "edcohen", "")])] },
    ]);
    await syncGithubProjects("u1", { token: "t", fetch, identities: IDS, now: NOW });
    expect(upserted().map((u) => u.create.company)).toEqual(["Olto", "Infinite Machine"]);
  });

  it("throws a status-bearing error when GitHub rejects the token", async () => {
    const fetch = vi.fn(async () => new Response("bad", { status: 401 }));
    await expect(syncGithubProjects("u1", { token: "t", fetch, now: NOW })).rejects.toMatchObject({ status: 401 });
  });
});

describe("helpers", () => {
  it("parses identities case-insensitively", () => {
    expect([...parseIdentities(" EdCohen, eddie@InfiniteMachine.com ,,")]).toEqual(["edcohen", "eddie@infinitemachine.com"]);
  });

  it("myCommits ignores commits with no author", () => {
    const refs = [{ name: "main", target: { history: { nodes: [{ oid: "x", messageHeadline: "m", committedDate: daysAgo(1), url: "u", author: null }] } } }];
    expect(myCommits(refs, "main", parseIdentities(IDS))).toEqual([]);
  });
});
