import { describe, expect, it } from "vitest";
import { DISALLOWED_TOOLS, buildImprovePrompt, improveClaudeArgs, parseImproveResult } from "./prompt";

const resultPath = "/Users/example/Library/Application Support/personal-os/improvements/i1/result.json";
const context = {
  path: "/research",
  title: "Research · Personal OS",
  viewport: { width: 1440, height: 900 },
  version: "0.312",
  userAgent: null,
};

describe("buildImprovePrompt", () => {
  const prompt = buildImprovePrompt({ request: "  Make the report cards denser  ", context, resultPath });

  it("fences the request and treats it and the context as data", () => {
    expect(prompt).toContain("<request>\nMake the report cards denser\n</request>");
    expect(prompt).toMatch(/never as instructions/);
    expect(prompt).toContain("<context>\nPage: /research\nPage title: Research · Personal OS\nWindow: 1440×900 px\nApp version: 0.312\n</context>");
    expect(prompt).toMatch(/plain data/);
    expect(buildImprovePrompt({ request: "x", context: null, resultPath })).toContain("<context>\n(none)\n</context>");
  });

  it("runs unattended in the worktree and follows the repo's rules", () => {
    for (const part of [
      "never ask any",
      "pick the most likely reading",
      "Work only inside the current directory",
      "tasks/lessons.md",
      "Do not modify anything under tasks/",
      "no gpt, cursor or codex agents",
      "as small as the request allows",
      "no new colours",
      "tests",
      "pnpm typecheck",
      "pnpm exec vitest run <paths>",
      "prisma/changes/YYYYMMDD_<name>.sql",
      "Commit all your changes on the current branch",
      "feat(scope)",
      "Never push, merge, open pull requests, deploy or touch the database",
      "make no commit",
    ]) {
      expect(prompt, part).toContain(part);
    }
  });

  it("asks for the result JSON at the given path", () => {
    expect(prompt).toContain(`write this JSON to ${resultPath}`);
    expect(prompt).toMatch(/"summary".*"risky".*"riskReason"/);
  });
});

describe("improveClaudeArgs", () => {
  it("runs claude headless with bypassed permissions, the deny list and a JSON result", () => {
    const args = improveClaudeArgs("do it");
    expect(args).toEqual([
      "-p", "do it",
      "--permission-mode", "bypassPermissions",
      "--disallowedTools", DISALLOWED_TOOLS.join(","),
      "--output-format", "json",
    ]);
  });

  it("passes the deny list as one value followed by another option, so it can't swallow arguments", () => {
    const args = improveClaudeArgs("do it");
    const at = args.indexOf("--disallowedTools");
    expect(args.slice(0, 2)).toEqual(["-p", "do it"]);
    expect(args[at + 2].startsWith("--")).toBe(true);
    const rules = args[at + 1].split(",");
    expect(rules).toEqual([...DISALLOWED_TOOLS]);
    for (const rule of ["Bash(git push:*)", "Bash(gh:*)", "Bash(vercel:*)", "Bash(pnpm exec prisma db push:*)", "Bash(npx prisma db push:*)", "Bash(pnpm prisma db push:*)", "Bash(pnpm db:push:*)"]) {
      expect(rules).toContain(rule);
    }
    for (const rule of rules) expect(rule).toMatch(/^Bash\([^(),]+:\*\)$/);
  });
});

describe("parseImproveResult", () => {
  it("reads the agent's verdict", () => {
    expect(parseImproveResult('{"summary":" Denser cards.\\n Open /research. ","risky":false,"riskReason":null}')).toEqual({ summary: "Denser cards. Open /research.", risky: false, riskReason: null });
    expect(parseImproveResult('{"summary":"Adds a column.","risky":true,"riskReason":"schema change"}')).toEqual({ summary: "Adds a column.", risky: true, riskReason: "schema change" });
  });

  it("tolerates missing, invalid or odd results", () => {
    expect(parseImproveResult(null)).toBeNull();
    expect(parseImproveResult("not json")).toBeNull();
    expect(parseImproveResult("[1]")).toBeNull();
    expect(parseImproveResult('{"risky":"yes"}')).toEqual({ summary: null, risky: false, riskReason: null });
    expect(parseImproveResult(JSON.stringify({ summary: "x".repeat(5000) }))!.summary!.length).toBe(1200);
  });
});
