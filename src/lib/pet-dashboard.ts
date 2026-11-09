// What the pet dashboard reads, shared by <PetDashboard> and
// GET /api/projects/[id] so the web and the native app can't drift.

import { prisma } from "@/lib/prisma";

export type VaccinationDueStatus = "overdue" | "due-soon" | "ok" | "unknown";

/** A booster due within this many days is "due soon". */
export const VACCINATION_DUE_SOON_DAYS = 30;

export function loadPetDashboard(projectId: string) {
  return prisma.pet.findUnique({
    where: { projectId },
    include: {
      weights: { orderBy: { measuredAt: "desc" } },
      vaccinations: { orderBy: { administeredAt: "desc" } },
      vetVisits: { orderBy: { performedAt: "desc" } },
      photos: { orderBy: { position: "asc" } },
      shoppingItems: {
        orderBy: [{ completedAt: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      },
      recommendations: {
        where: { completedAt: null, dismissedAt: null },
        orderBy: { position: "asc" },
      },
    },
  });
}

export type PetDashboardData = NonNullable<Awaited<ReturnType<typeof loadPetDashboard>>>;

export function vaccinationStatus(
  boosterDueAt: Date | string | null,
  now = new Date(),
): { status: VaccinationDueStatus; daysFromNow: number | null } {
  if (!boosterDueAt) return { status: "unknown", daysFromNow: null };
  const days = Math.floor((new Date(boosterDueAt).getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return { status: "overdue", daysFromNow: days };
  if (days <= VACCINATION_DUE_SOON_DAYS) return { status: "due-soon", daysFromNow: days };
  return { status: "ok", daysFromNow: days };
}

/** The dashboard's data as JSON: each vaccination carries its booster status, as the dashboard shows it. */
export function petDashboardJson(pet: PetDashboardData, now = new Date()) {
  return {
    ...pet,
    vaccinations: pet.vaccinations.map((v) => ({ ...v, due: vaccinationStatus(v.boosterDueAt, now) })),
  };
}
