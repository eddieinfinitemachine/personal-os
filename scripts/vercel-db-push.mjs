// Runs in the Vercel build so a merged schema change reaches the database
// before the code that needs it goes live. Twice now a PR merged with a new
// column and production 500'd until someone pushed the schema by hand
// (tasks/lessons.md, 2026-10-08 and 2026-10-27).
//
// Only the production build pushes. Preview builds come from feature branches,
// and pushing an older schema from one would drop columns main has added.
// `db push` without --accept-data-loss refuses any destructive change, so a
// stale production build fails instead of losing data.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const env = process.env.VERCEL_ENV ?? "unset";
const prismaBin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../node_modules/.bin/prisma",
);

if (env !== "production") {
  console.log(`[db-push] skipped: VERCEL_ENV=${env}`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("[db-push] DATABASE_URL is not set; refusing to build production");
  process.exit(1);
}

console.log("[db-push] syncing production schema from prisma/schema.prisma");
execFileSync(prismaBin, ["db", "push", "--skip-generate"], { stdio: "inherit" });
