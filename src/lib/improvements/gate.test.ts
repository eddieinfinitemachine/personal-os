import { describe, expect, it } from "vitest";
import { MAX_CHANGED_LINES, assessRisk, parseAddedLines, parseNumstat, type AddedLine, type DiffFile } from "./gate";

const file = (path: string, added = 1, deleted = 0): DiffFile => ({ path, added, deleted });
const assess = (files: DiffFile[], addedLines: AddedLine[] = [], agentRisky = false, agentReason: string | null = null) =>
  assessRisk({ files, addedLines, agentRisky, agentReason });

describe("assessRisk", () => {
  it("lets a small UI change through", () => {
    expect(assess([file("src/components/sidebar.tsx", 12, 3), file("src/components/sidebar.test.tsx", 20)])).toEqual({ risky: false, reasons: [] });
  });

  it("flags schema, auth, dependency, deploy-config and LaunchAgent paths", () => {
    const cases: [string, RegExp][] = [
      ["prisma/schema.prisma", /database schema \(prisma\/\)/],
      ["prisma/changes/20261102_x.sql", /database schema/],
      ["src/middleware.ts", /auth/],
      ["src/proxy.ts", /auth/],
      ["src/lib/auth.ts", /auth/],
      ["src/lib/auth-tokens.ts", /auth/],
      ["src/app/login/page.tsx", /auth/],
      ["src/app/api/auth/verify/route.ts", /auth/],
      ["package.json", /dependencies/],
      ["pnpm-lock.yaml", /dependencies/],
      ["vercel.json", /build or deploy config/],
      ["next.config.ts", /build or deploy config/],
      ["scripts/launchagents/com.personal-os.x.plist", /LaunchAgent/],
    ];
    for (const [path, reason] of cases) {
      const result = assess([file(path)]);
      expect(result.risky, path).toBe(true);
      expect(result.reasons.join("; "), path).toMatch(reason);
    }
  });

  it("flags the improve machinery but not the dialog's UI", () => {
    for (const path of ["scripts/improve-worker.ts", "scripts/lib/headless-claude.ts", "src/lib/improvements/gate.ts", "src/app/api/improvements/route.ts"]) {
      expect(assess([file(path)]).reasons, path).toEqual(["changes the improve worker itself"]);
    }
    expect(assess([file("src/components/improve/improve-dialog.tsx")]).risky).toBe(false);
    expect(assess([file("src/lib/authors.ts")]).risky).toBe(true); // src/lib/auth* is deliberately broad
    expect(assess([file("src/app/settings/page.tsx")]).risky).toBe(false);
  });

  it("reports each reason once", () => {
    expect(assess([file("prisma/schema.prisma"), file("prisma/changes/a.sql")]).reasons).toEqual(["changes the database schema (prisma/)"]);
  });

  it("flags added code that deletes or drops data, outside tests", () => {
    const risky = [
      "await prisma.todo.deleteMany({ where: { userId } });",
      "await tx.person.delete({ where: { id } })",
      "db.list.delete( { where } )",
      'ALTER TABLE "Todo" DROP COLUMN "notes";',
      "drop table if exists foo;",
      'TRUNCATE "Todo";',
      "truncate table foo",
      'await prisma.$executeRaw`DELETE FROM "Todo" WHERE 1=1`',
    ];
    for (const line of risky) {
      const result = assess([file("src/lib/x.ts")], [{ path: "src/lib/x.ts", line }]);
      expect(result.reasons, line).toEqual(["adds code that deletes or drops data"]);
    }
    const safe = [
      "cache.delete(key);",
      "url.searchParams.delete('page');",
      "this.pending.delete(id);",
      'params.delete("q")',
      '<span className="truncate text-sm">{title}</span>',
      "Delete from list",
      "const dropped = items.filter(Boolean);",
    ];
    for (const line of safe) {
      expect(assess([file("src/components/x.tsx")], [{ path: "src/components/x.tsx", line }]).risky, line).toBe(false);
    }
    expect(assess([file("src/lib/x.test.ts")], [{ path: "src/lib/x.test.ts", line: "await prisma.todo.deleteMany();" }]).risky).toBe(false);
    expect(assess([file("src/x.test.tsx")], [{ path: "src/x.test.tsx", line: "DROP TABLE x" }]).risky).toBe(false);
  });

  it("flags changes over the line budget", () => {
    expect(assess([file("src/a.ts", MAX_CHANGED_LINES / 2, MAX_CHANGED_LINES / 2)]).risky).toBe(false);
    const big = assess([file("src/a.ts", 500, 200), file("src/b.ts", 101, 0)]);
    expect(big.reasons).toEqual(["changes 801 lines (over 800)"]);
  });

  it("includes the agent's own verdict and reason", () => {
    expect(assess([file("src/a.ts")], [], true, "  Rewrites   the export\nformat ").reasons).toEqual(["the agent flagged it: Rewrites the export format"]);
    expect(assess([file("src/a.ts")], [], true, null).reasons).toEqual(["the agent flagged it as risky"]);
    expect(assess([file("src/a.ts")], [], false, "ignored without risky").risky).toBe(false);
  });
});

describe("diff parsing", () => {
  it("reads numstat rows, counting binary files as zero lines", () => {
    expect(parseNumstat("3\t1\tsrc/a.ts\n-\t-\tpublic/icon.png\n10\t0\tprisma/schema.prisma\n\n")).toEqual([
      { path: "src/a.ts", added: 3, deleted: 1 },
      { path: "public/icon.png", added: 0, deleted: 0 },
      { path: "prisma/schema.prisma", added: 10, deleted: 0 },
    ]);
    expect(parseNumstat("1\t0\tsrc/café.ts\x002\t2\tprisma/schema.prisma\x00")).toEqual([
      { path: "src/café.ts", added: 1, deleted: 0 },
      { path: "prisma/schema.prisma", added: 2, deleted: 2 },
    ]);
    expect(parseNumstat("")).toEqual([]);
  });

  it("collects added lines per file and skips headers, context and removals", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1,2 @@",
      "-old line",
      "+new line",
      "+++counter;",
      "diff --git a/src/gone.ts b/src/gone.ts",
      "deleted file mode 100644",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1 @@",
      "+export const x = 1;",
      "",
    ].join("\n");
    expect(parseAddedLines(diff)).toEqual([
      { path: "src/a.ts", line: "new line" },
      { path: "src/a.ts", line: "++counter;" },
      { path: "src/new.ts", line: "export const x = 1;" },
    ]);
  });
});
