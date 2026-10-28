// Read-only /projects dry run: collects the real signals (todos and notes from
// the database, Calendar, Gmail; Granola only when GRANOLA_API_KEY is set),
// runs the inference, and prints what the page would show. Writes nothing:
// it never imports the store, and its Prisma client refuses every write.
//
//   pnpm exec tsx --env-file=.env scripts/projects-dry-run.ts [--twice] [--json <file>]
//
// --twice feeds run 1 back in as the previous projects and prints which keys
// changed (flicker check). --json writes the final projects to a file (for
// seeding a scratch database). Exclusions print as counts only.

import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const READS = new Set(["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);

const readOnly = new PrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!READS.has(operation)) throw new Error(`dry run: ${model}.${operation} blocked (read-only)`);
        return query(args);
      },
    },
    async $executeRaw() {
      throw new Error("dry run: $executeRaw blocked");
    },
    async $executeRawUnsafe() {
      throw new Error("dry run: $executeRawUnsafe blocked");
    },
  },
});
// src/lib/prisma.ts reuses globalThis.prisma, so every module below gets this client.
(globalThis as unknown as { prisma: unknown }).prisma = readOnly;

async function main() {
  const args = process.argv.slice(2);
  const twice = args.includes("--twice");
  const jsonAt = args.indexOf("--json");
  const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : null;

  const { getFounderUser } = await import("@/lib/cron");
  const { collectSignals } = await import("@/lib/projects/signals");
  const { EXCLUSION_RULES } = await import("@/lib/projects/signals/gate");
  const { failureClass } = await import("@/lib/projects/signals/errors");
  const { buildPrompt, evidenceHash, inferProjects } = await import("@/lib/projects/infer");
  type InferredProject = import("@/lib/projects/infer").InferredProject;
  type PreviousProject = import("@/lib/projects/infer").PreviousProject;

  const now = new Date();
  console.log(`/projects dry run, ${now.toISOString()} (read-only)`);
  const founder = await getFounderUser();
  if (!founder) throw new Error("founder user not found (FOUNDER_EMAIL)");

  const granolaKey = !!process.env.GRANOLA_API_KEY?.trim();
  if (!granolaKey) console.log("GRANOLA_API_KEY is not set here: meetings come from Google Calendar only.");

  let signals;
  try {
    signals = await collectSignals(founder.id, { now });
  } catch (e) {
    console.log(`Collecting signals failed: ${failureClass(e)}`);
    process.exitCode = 1;
    return;
  }
  const c = signals.counts;
  console.log("\n## Sources (collected → kept after the gate)");
  console.log(`- Calendar: ${c.calendarEvents} meetings with other people (past 14 d + next 7 d)`);
  console.log(`- Granola: ${c.granolaNotes === null ? "not configured" : `${c.granolaNotes} notes`}`);
  console.log(`  → meetings kept: ${c.meetings} (${signals.items.filter((i) => i.upcoming).length} upcoming)`);
  console.log(`- Gmail: ${c.gmailThreads} sent threads; dropped ${c.gmailRsvp} RSVP/invites, ${c.gmailSelfOnly} self-only → kept ${c.emails}`);
  console.log(`- Todos: ${c.todos} → kept ${c.todoItems}`);
  console.log(`- Notes: ${c.notes} → kept ${c.noteItems}`);

  console.log("\n## Excluded by the privacy gate (counts only)");
  for (const rule of EXCLUSION_RULES) console.log(`- ${rule}: ${signals.excluded[rule]}`);

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.log("\nANTHROPIC_API_KEY is not set: stopping before the inference.");
    process.exitCode = 1;
    return;
  }

  const prompt = buildPrompt(signals.items, []);
  console.log(`\n## Prompt: ${prompt.ids.size} items, ${prompt.omitted} omitted for the budget, ${prompt.user.length} chars`);
  console.log(`Evidence hash: ${evidenceHash(signals.items)}`);

  const run = async (label: string, previous: PreviousProject[]) => {
    const started = Date.now();
    try {
      const { projects } = await inferProjects({ items: signals.items, previous, now, isSensitive: signals.gate.matchesText });
      console.log(`\n## ${label}: ${projects.length} projects (${((Date.now() - started) / 1000).toFixed(1)} s)`);
      for (const p of projects) printProject(p);
      return projects;
    } catch (e) {
      console.log(`\n## ${label}: inference failed (${failureClass(e)})`);
      process.exitCode = 1;
      return null;
    }
  };

  const first = await run("Run 1", []);
  let last = first;
  if (first && twice) {
    const previous: PreviousProject[] = first.map((p) => ({
      key: p.key,
      name: p.name,
      company: p.company,
      status: p.status,
      next: p.next,
      state: "auto",
      refs: p.evidence.map((e) => e.ref),
    }));
    const second = await run("Run 2 (run 1 as previous)", previous);
    if (second) {
      last = second;
      const a = new Map(first.map((p) => [p.key, p]));
      const b = new Map(second.map((p) => [p.key, p]));
      const kept = [...b.keys()].filter((k) => a.has(k));
      const added = [...b.keys()].filter((k) => !a.has(k));
      const removed = [...a.keys()].filter((k) => !b.has(k));
      const renamed = kept.filter((k) => a.get(k)!.name !== b.get(k)!.name);
      console.log("\n## Key changes, run 1 → run 2");
      console.log(`- kept: ${kept.length} (${kept.join(", ") || "-"})`);
      console.log(`- added: ${added.length} (${added.join(", ") || "-"})`);
      console.log(`- removed: ${removed.length} (${removed.join(", ") || "-"})`);
      console.log(`- renamed under the same key: ${renamed.length}${renamed.map((k) => `\n  ${k}: "${a.get(k)!.name}" → "${b.get(k)!.name}"`).join("")}`);
    }
  }

  if (jsonPath && last) {
    writeFileSync(jsonPath, JSON.stringify({ at: now.toISOString(), hash: evidenceHash(signals.items), projects: last }, null, 2));
    console.log(`\nWrote ${last.length} projects to ${jsonPath}`);
  }

  function printProject(p: InferredProject) {
    const counts = new Map<string, number>();
    for (const e of p.evidence) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    console.log(`\n### ${p.name}  [${p.key}]`);
    console.log(`Company: ${p.company} · last touched ${p.lastActivityAt?.slice(0, 10) ?? "-"}`);
    console.log(`Status: ${p.status ?? "-"}`);
    console.log(`Next: ${p.next ?? "-"}`);
    console.log(`Evidence: ${[...counts].map(([k, n]) => `${n} ${k}`).join(" · ")}`);
    for (const e of p.evidence) console.log(`  - ${e.kind} ${e.at.slice(0, 10)}${Date.parse(e.at) > now.getTime() ? " (upcoming)" : ""}: ${e.title}`);
  }
}

main()
  .catch((e) => {
    console.error("dry run failed:", e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => readOnly.$disconnect());
