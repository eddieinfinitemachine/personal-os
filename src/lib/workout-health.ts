// Health data for the workout planner: the Prisma loader for the user's
// Personal health profile (Human). The pure parts (snapshot, recovery read,
// prompt section, plan-review facts) live in workout-readiness.ts and are
// re-exported here, so existing imports keep working; the client only imports
// types from here.

import { prisma } from "@/lib/prisma";
import { RECOVERY_WINDOW_DAYS, buildSnapshot, type HealthSnapshot } from "./workout-readiness";

export * from "./workout-readiness";

const DAY = 86_400_000;

/** The user's own health profile (their first Human), or null without one. */
export async function loadHealth(userId: string, now = Date.now()): Promise<HealthSnapshot | null> {
  const human = await prisma.human.findFirst({
    where: { project: { userId, archived: false } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sex: true,
      birthDate: true,
      heightInches: true,
      conditionsJson: true,
      biometrics: {
        where: { kind: { in: ["hrv", "rhr"] }, measuredAt: { gte: new Date(now - RECOVERY_WINDOW_DAYS * DAY) } },
        orderBy: { measuredAt: "desc" },
        take: 200,
      },
      fitnessSessions: {
        where: { performedAt: { gte: new Date(now - 3 * DAY) }, kind: { not: "lift" } },
        orderBy: { performedAt: "desc" },
        take: 10,
      },
    },
  });
  if (!human) return null;
  const body = await prisma.biometricReading.findMany({
    where: { humanId: human.id, kind: { in: ["weight", "bodyFat", "vo2"] } },
    orderBy: { measuredAt: "desc" },
    distinct: ["kind"],
  });
  return buildSnapshot({ ...human, recovery: human.biometrics, body, activity: human.fitnessSessions }, now);
}
