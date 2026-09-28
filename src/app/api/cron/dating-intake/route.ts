import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { prisma } from "@/lib/prisma";
import { syncGranolaIntake } from "@/lib/dating-intake/granola";
import { processSource } from "@/lib/dating-intake/extract";
import { cleanupSource } from "@/lib/dating-intake/store";
import { refreshDatingInsights } from "@/lib/dating-insights";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!isAuthorizedCron(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const start = Date.now();
  let processed = 0,
    failed = 0;
  // Retention is independent of source enablement; paused sources still expire raw text.
  const cleanup = await prisma.datingSourceState.findMany({
    where: {
      records: {
        some: {
          status: {
            in: ["receiving", "pending", "retry", "processing", "extracted"],
          },
          createdAt: { lt: new Date(Date.now() - 86400000) },
        },
      },
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
  });
  for (const s of cleanup) {
    if (Date.now() - start > 40000) break;
    try {
      await cleanupSource(s.userId, s.id);
    } catch {
      failed++;
      console.error("Dating intake cleanup failed");
    }
  }

  // Fairness: sources with oldest actual attempts come first. Claims prevent duplicate jobs.
  const states = await prisma.datingSourceState.findMany({
    where: { enabled: true },
    orderBy: { updatedAt: "asc" },
    take: 20,
  });
  for (const state of states) {
    if (Date.now() - start > 220000) break;
    try {
      if (state.source === "granola")
        await syncGranolaIntake(state.userId, state.id);
      await processSource(state.userId, state.id);
      processed++;
    } catch {
      failed++;
      console.error("Dating intake cron source failed");
    }
  }
  const people = await prisma.datingPerson.findMany({
    where: {
      insightsAt: null,
      OR: [
        { events: { some: { sourceRecordId: { not: null } } } },
        {
          candidates: {
            some: {
              status: "approved",
              suggestions: {
                some: {
                  status: "added",
                  sourceRecord: { status: "processed" },
                },
              },
            },
          },
        },
      ],
    },
    take: 3,
    orderBy: { updatedAt: "asc" },
    select: { id: true, userId: true },
  });
  for (const person of people) {
    if (Date.now() - start > 250000) break;
    try {
      await refreshDatingInsights(person.userId, person.id, {
        onlyIfStale: true,
        timeoutMs: Math.min(20000, 280000 - (Date.now() - start)),
      });
    } catch {
      console.error("Dating intake summary refresh failed");
    }
  }
  return NextResponse.json({ processed, failed });
}
