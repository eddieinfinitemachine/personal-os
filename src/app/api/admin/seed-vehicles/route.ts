import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Seed Eddie's other vehicles. Idempotent — re-running upserts each by name.

type VehicleSeed = {
  projectName: string;
  color: string;
  vehicle: {
    make: string;
    model: string;
    year: number;
    bodyStyle?: string;
    exteriorColor?: string;
    transmission?: string;
    currentMileage?: number;
    mileageUnit?: string;
    notes?: string;
  };
};

const SEEDS: VehicleSeed[] = [
  {
    projectName: "Infinite Machine P1",
    color: "violet",
    vehicle: {
      make: "Infinite Machine",
      model: "P1",
      year: 2024,
      bodyStyle: "Electric scooter",
      exteriorColor: "Aluminum",
      transmission: "Direct drive",
      mileageUnit: "mi",
      notes:
        "Infinite Machine flagship P1 electric scooter — the geometric, anodized-aluminum personal EV. Range ~60mi, top speed ~55mph in performance mode.",
    },
  },
  {
    projectName: "Infinite Machine Olto",
    color: "emerald",
    vehicle: {
      make: "Infinite Machine",
      model: "Olto",
      year: 2026,
      bodyStyle: "Electric moped / e-bike",
      exteriorColor: "—",
      transmission: "Direct drive",
      mileageUnit: "mi",
      notes:
        "Infinite Machine Olto — Class-2 e-bike form factor, launched Spring 2026 around the Earth Day relaunch campaign. ~40mi range, 20mph capped, pedal-assist + throttle.",
    },
  },
  {
    projectName: "Rivian",
    color: "blue",
    vehicle: {
      make: "Rivian",
      model: "R1S",
      year: 2024,
      bodyStyle: "Electric SUV",
      mileageUnit: "mi",
      notes: "Daily / weekend hauler.",
    },
  },
  {
    projectName: "Subaru Sambar",
    color: "amber",
    vehicle: {
      make: "Subaru",
      model: "Sambar",
      year: 1995,
      bodyStyle: "Kei van",
      transmission: "5-speed manual",
      mileageUnit: "km",
      notes:
        "Imported JDM kei van — toy / utility runabout. RHD, 660cc 3-cyl.",
    },
  },
];

export async function POST() {
  const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const founder = await prisma.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) return NextResponse.json({ error: "founder user missing" }, { status: 500 });
  const userId = founder.id;

  const created: string[] = [];
  for (const seed of SEEDS) {
    let project = await prisma.project.findFirst({
      where: { userId, name: seed.projectName, archived: false },
    });
    if (!project) {
      const max = await prisma.project.aggregate({ where: { userId }, _max: { position: true } });
      project = await prisma.project.create({
        data: {
          userId,
          name: seed.projectName,
          kind: "vehicle",
          icon: "Car",
          color: seed.color,
          position: (max._max.position ?? -1) + 1,
        },
      });
    } else if (project.kind !== "vehicle") {
      project = await prisma.project.update({
        where: { id: project.id },
        data: { kind: "vehicle" },
      });
    }

    const existing = await prisma.vehicle.findUnique({
      where: { projectId: project.id },
    });
    if (existing) {
      await prisma.vehicle.update({
        where: { projectId: project.id },
        data: seed.vehicle,
      });
    } else {
      await prisma.vehicle.create({
        data: { ...seed.vehicle, projectId: project.id, userId },
      });
    }
    created.push(seed.projectName);
  }
  return NextResponse.json({ ok: true, vehicles: created });
}
