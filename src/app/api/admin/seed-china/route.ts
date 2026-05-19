import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const founder = await prisma.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) return NextResponse.json({ error: "founder user missing" }, { status: 500 });
  const userId = founder.id;

  // Find the existing "China" project (any kind), or create a new pet project.
  let project = await prisma.project.findFirst({
    where: { userId, name: "China" },
    include: { pet: true },
  });

  if (project && project.pet) {
    return NextResponse.json({ projectId: project.id, alreadyExists: true });
  }

  if (!project) {
    const max = await prisma.project.aggregate({ where: { userId }, _max: { position: true } });
    project = await prisma.project.create({
      data: {
        userId,
        name: "China",
        kind: "pet",
        icon: "Cat",
        color: "rose",
        position: (max._max.position ?? -1) + 1,
      },
      include: { pet: true },
    });
  } else if (project.kind !== "pet") {
    project = await prisma.project.update({
      where: { id: project.id },
      data: { kind: "pet", icon: "Cat" },
      include: { pet: true },
    });
  }

  const pet = await prisma.pet.create({
    data: {
      projectId: project.id,
      userId,
      name: "China",
      species: "cat",
      sex: "F",
      birthDate: new Date("2025-03-08"),
      spayedNeuteredAt: new Date("2025-09-15"),
      feedingSchedule: "3 oz over 3 meals",
    },
  });

  await prisma.petWeight.createMany({
    data: [
      { petId: pet.id, userId, measuredAt: new Date("2025-06-03"), weightLb: 2.7 },
      { petId: pet.id, userId, measuredAt: new Date("2025-06-06"), weightLb: 3.1 },
      { petId: pet.id, userId, measuredAt: new Date("2025-08-22"), weightLb: 6.0 },
    ],
  });

  await prisma.petVaccination.createMany({
    data: [
      {
        petId: pet.id,
        userId,
        name: "First round (puppy series)",
        administeredAt: new Date("2025-05-18"),
        boosterDueAt: new Date("2025-06-15"),
        notes: "First round of shots — verify subsequent puppy boosters and adult vaccines.",
      },
    ],
  });

  await prisma.petVetVisit.createMany({
    data: [
      {
        petId: pet.id,
        userId,
        performedAt: new Date("2025-09-15"),
        reason: "Spay surgery",
        details: "Spayed in September 2025.",
      },
    ],
  });

  return NextResponse.json({ projectId: project.id, alreadyExists: false });
}
