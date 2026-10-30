import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  claude: vi.fn(),
  founder: vi.fn(),
  todoFindUnique: vi.fn(),
  jobCreate: vi.fn(),
  reportCreate: vi.fn(),
}));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: mocks.claude }));
vi.mock("@/lib/cron", () => ({ getFounderUser: mocks.founder }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    todo: { findUnique: mocks.todoFindUnique },
    agentJob: { create: mocks.jobCreate },
    researchReport: { create: mocks.reportCreate },
  },
}));
import { buildTriagePrompt, isSensitiveTodo, triageTodo, validateTriage, TRIAGE_MODEL } from "./triage";
import { branchName, parseAgentRepos } from "./job";

const repos = parseAgentRepos("eddie/personal-os=the EC app, eddie/site=marketing site");

describe("parseAgentRepos", () => {
  it("parses owner/name=description pairs and drops junk", () => {
    expect(repos).toEqual([
      { name: "eddie/personal-os", description: "the EC app" },
      { name: "eddie/site", description: "marketing site" },
    ]);
    expect(parseAgentRepos("  ")).toEqual([]);
    expect(parseAgentRepos("not a repo, eddie/ok")).toEqual([{ name: "eddie/ok", description: "" }]);
    expect(parseAgentRepos(undefined)).toEqual([]);
  });
});

describe("branchName", () => {
  it("is short, lowercase and git-safe", () => {
    expect(branchName("clxyzabc123456", "Fix the login form: it 500s!")).toBe("agent/123456-fix-the-login-form-it-500s");
    expect(branchName("clxyzabc123456", "   ")).toBe("agent/123456");
    expect(branchName("clxyzabc123456", "a".repeat(100)).length).toBeLessThan(60);
  });
});

describe("isSensitiveTodo", () => {
  it("keeps health, family, dating and therapy items away from Claude", () => {
    expect(isSensitiveTodo({ title: "Book dentist appointment", notes: null })).toBe(true);
    expect(isSensitiveTodo({ title: "Call mom", notes: null })).toBe(true);
    expect(isSensitiveTodo({ title: "Plan", notes: "second date on Friday" })).toBe(true);
    expect(isSensitiveTodo({ title: "Therapy", notes: null })).toBe(true);
    expect(isSensitiveTodo({ title: "Fix the sidebar collapse bug", notes: null })).toBe(false);
  });
});

describe("buildTriagePrompt", () => {
  it("lists the allowed repos and fences the todo", () => {
    const { system, user } = buildTriagePrompt({ title: "Add dark mode toggle", notes: "Settings page", listName: "To Do", projectName: "EC" }, repos);
    expect(system).toContain("- eddie/personal-os: the EC app");
    expect(system).toContain("- eddie/site: marketing site");
    expect(user).toBe("<todo>\nTitle: Add dark mode toggle\nList: To Do\nProject: EC\nNotes: Settings page\n</todo>");
  });

  it("says so when no repos are configured", () => {
    expect(buildTriagePrompt({ title: "x", notes: null, listName: "To Do", projectName: null }, []).system).toContain("never answer \"code\"");
  });
});

describe("validateTriage", () => {
  it("accepts a code answer naming an allowed repo", () => {
    expect(validateTriage({ kind: "code", repo: "eddie/site", confidence: 0.9, plan: "Change the hero copy." }, repos))
      .toEqual({ kind: "code", repo: "eddie/site", confidence: 0.9, plan: "Change the hero copy." });
  });

  it("downgrades code answers for unknown repos, and junk to none", () => {
    expect(validateTriage({ kind: "code", repo: "someone/else", confidence: 0.95, plan: "p" }, repos)).toMatchObject({ kind: "none", repo: null });
    expect(validateTriage({ kind: "research", repo: "eddie/site", confidence: 2, plan: 7 }, repos)).toEqual({ kind: "research", repo: null, confidence: 1, plan: "" });
    expect(validateTriage("nope", repos)).toEqual({ kind: "none", repo: null, confidence: 0, plan: "" });
    expect(validateTriage({ kind: "email", confidence: 0.99 }, repos)).toMatchObject({ kind: "none" });
  });
});

describe("triageTodo", () => {
  const todo = {
    id: "t1", userId: "founder", title: "Add a dark mode toggle to settings", notes: null, parentId: null, autopilotKey: null,
    list: { name: "To Do" }, project: null, agentJob: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_ENABLED", "1");
    vi.stubEnv("AGENT_REPOS", "eddie/personal-os=the EC app");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.founder.mockResolvedValue({ id: "founder", email: "f@x.test" });
    mocks.todoFindUnique.mockResolvedValue(todo);
    mocks.jobCreate.mockResolvedValue({});
    mocks.reportCreate.mockResolvedValue({ id: "r1" });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("does nothing unless AGENT_ENABLED is set", async () => {
    vi.stubEnv("AGENT_ENABLED", "");
    await triageTodo("t1");
    expect(mocks.todoFindUnique).not.toHaveBeenCalled();
  });

  it("ignores subtasks, autopilot todos, already-triaged todos and other users", async () => {
    mocks.todoFindUnique.mockResolvedValueOnce({ ...todo, parentId: "p" });
    await triageTodo("t1");
    mocks.todoFindUnique.mockResolvedValueOnce({ ...todo, autopilotKey: "vehicle:x" });
    await triageTodo("t1");
    mocks.todoFindUnique.mockResolvedValueOnce({ ...todo, agentJob: { id: "j" } });
    await triageTodo("t1");
    mocks.todoFindUnique.mockResolvedValueOnce({ ...todo, userId: "friend" });
    await triageTodo("t1");
    expect(mocks.claude).not.toHaveBeenCalled();
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });

  it("skips private todos without calling Claude", async () => {
    mocks.todoFindUnique.mockResolvedValueOnce({ ...todo, title: "Refill prescription" });
    await triageTodo("t1");
    expect(mocks.claude).not.toHaveBeenCalled();
    expect(mocks.jobCreate.mock.calls[0][0].data).toMatchObject({ todoId: "t1", kind: "none", status: "skipped" });
    expect(JSON.stringify(mocks.jobCreate.mock.calls[0][0])).not.toContain("prescription");
  });

  it("queues a code job when Claude is confident about an allowed repo", async () => {
    mocks.claude.mockResolvedValueOnce({ kind: "code", repo: "eddie/personal-os", confidence: 0.9, plan: "Add a toggle on /settings." });
    await triageTodo("t1");
    const call = mocks.claude.mock.calls[0][0];
    expect(call.model).toBe(TRIAGE_MODEL);
    expect(call.user).toContain("Title: Add a dark mode toggle to settings");
    expect(mocks.jobCreate.mock.calls[0][0].data).toEqual({
      userId: "founder", todoId: "t1", kind: "code", status: "queued", confidence: 0.9, plan: "Add a toggle on /settings.", repo: "eddie/personal-os",
    });
  });

  it("records a skip below the confidence bar or for none", async () => {
    mocks.claude.mockResolvedValueOnce({ kind: "code", repo: "eddie/personal-os", confidence: 0.5, plan: "Maybe." });
    await triageTodo("t1");
    expect(mocks.jobCreate.mock.calls[0][0].data).toMatchObject({ kind: "code", status: "skipped", confidence: 0.5 });
    mocks.claude.mockResolvedValueOnce({ kind: "none", repo: null, confidence: 0.99, plan: "An email." });
    await triageTodo("t1");
    expect(mocks.jobCreate.mock.calls[1][0].data).toMatchObject({ kind: "none", status: "skipped", plan: "An email." });
  });

  it("hands research off to a queued ResearchReport", async () => {
    mocks.todoFindUnique.mockResolvedValueOnce({ ...todo, title: "Research Shaker furniture makers", notes: "focus on chairs" });
    mocks.claude.mockResolvedValueOnce({ kind: "research", repo: null, confidence: 0.95, plan: "Write a report." });
    await triageTodo("t1");
    expect(mocks.reportCreate.mock.calls[0][0].data).toEqual({
      userId: "founder", topic: "Research Shaker furniture makers\n\nfocus on chairs", title: "Research Shaker furniture makers", status: "queued",
    });
    expect(mocks.jobCreate.mock.calls[0][0].data).toMatchObject({ kind: "research", status: "done", resultUrl: "/research", resultJson: { researchReportId: "r1" } });
  });

  it("never throws when Claude or the database fails", async () => {
    mocks.claude.mockRejectedValueOnce(new Error("429"));
    await expect(triageTodo("t1")).resolves.toBeUndefined();
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    mocks.todoFindUnique.mockRejectedValueOnce(new Error("db down"));
    await expect(triageTodo("t1")).resolves.toBeUndefined();
  });
});
