// What the vehicle dashboard reads, shared by <VehicleDashboard> and
// GET /api/projects/[id] so the web and the native app can't drift.

import { prisma } from "@/lib/prisma";
import { computeDue } from "@/lib/maintenance";

export function loadVehicleDashboard(projectId: string) {
  return prisma.vehicle.findUnique({
    where: { projectId },
    include: {
      serviceItems: { orderBy: { position: "asc" } },
      serviceRecords: { orderBy: { performedAt: "desc" } },
      contacts: { orderBy: { position: "asc" } },
      photos: { orderBy: { position: "asc" } },
      shoppingItems: {
        orderBy: [{ completedAt: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      },
      recommendations: {
        where: { completedAt: null, dismissedAt: null },
        orderBy: { position: "asc" },
      },
      drives: { orderBy: { drivenAt: "desc" }, take: 20 },
    },
  });
}

export type VehicleDashboardData = NonNullable<Awaited<ReturnType<typeof loadVehicleDashboard>>>;

/** The dashboard's data as JSON: each service item carries its due status, as the maintenance grid shows it. */
export function vehicleDashboardJson(vehicle: VehicleDashboardData, now = new Date()) {
  return {
    ...vehicle,
    serviceItems: vehicle.serviceItems.map((item) => ({
      ...item,
      due: computeDue(item, vehicle.currentMileage, now),
    })),
  };
}
