import { prisma } from "@/lib/prisma";
import { ACTIVITY_WINDOW_DAYS, buildHealthSummary, type HealthSummary } from "./summary";

type HumanForSummary = {
  id: string;
  sex: string | null;
  birthDate: Date | null;
  notes: string | null;
  medicationsJson: unknown;
  conditionsJson: unknown;
  allergiesJson: unknown;
};

/** Reads everything the summary needs. Lab history is never truncated: trends depend on the oldest draw. */
export async function loadHealthSummary(human: HumanForSummary, now: Date): Promise<HealthSummary> {
  const humanId = human.id;
  const windowStart = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 86_400_000);
  const [labs, visits, fitness, dna, biometricReadings] = await Promise.all([
    prisma.labResult.findMany({
      where: { humanId },
      orderBy: { drawnAt: "asc" },
      select: {
        panel: true,
        marker: true,
        drawnAt: true,
        value: true,
        unit: true,
        refLow: true,
        refHigh: true,
        flag: true,
        notes: true,
      },
    }),
    prisma.medicalVisit.findMany({
      where: { humanId },
      orderBy: { performedAt: "desc" },
      select: { performedAt: true, specialty: true, reason: true, summary: true },
    }),
    prisma.fitnessSession.findMany({
      where: { humanId, performedAt: { gte: windowStart } },
      select: { performedAt: true, kind: true, durationMin: true },
    }),
    prisma.dnaResult.findMany({
      where: { humanId },
      orderBy: { title: "asc" },
      select: { category: true, title: true, finding: true },
    }),
    prisma.biometricReading.count({ where: { humanId } }),
  ]);
  return buildHealthSummary(
    {
      sex: human.sex,
      birthDate: human.birthDate,
      notes: human.notes,
      medications: human.medicationsJson,
      conditions: human.conditionsJson,
      allergies: human.allergiesJson,
      labs,
      visits,
      fitness,
      dna,
      biometricReadings,
    },
    now,
  );
}
