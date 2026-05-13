import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCoachItems } from "@/lib/coach";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pet = await prisma.pet.findUnique({
    where: { id },
    include: {
      weights: { orderBy: { measuredAt: "desc" }, take: 5 },
      vaccinations: { orderBy: { administeredAt: "desc" }, take: 5 },
      vetVisits: { orderBy: { performedAt: "desc" }, take: 3 },
    },
  });
  if (!pet) return NextResponse.json({ error: "pet not found" }, { status: 404 });

  const today = new Date();
  const dob = pet.birthDate ? new Date(pet.birthDate) : null;
  const ageMonths = dob
    ? (today.getFullYear() - dob.getFullYear()) * 12 +
      (today.getMonth() - dob.getMonth())
    : null;
  const sexLabel =
    pet.sex === "F"
      ? pet.spayedNeuteredAt
        ? "spayed female"
        : "intact female"
      : pet.sex === "M"
        ? pet.spayedNeuteredAt
          ? "neutered male"
          : "intact male"
        : "";

  const summary = [
    `Today: ${today.toISOString().slice(0, 10)} (season: ${seasonOf(today)})`,
    `Pet: ${pet.name}`,
    `Species: ${pet.species}`,
    pet.breed ? `Breed: ${pet.breed}` : null,
    sexLabel ? `Sex: ${sexLabel}` : null,
    ageMonths !== null ? `Age: ${ageMonths} months` : null,
    pet.feedingSchedule ? `Feeding: ${pet.feedingSchedule}` : null,
    pet.weights[0]
      ? `Latest weight: ${pet.weights[0].weightLb} lb on ${new Date(pet.weights[0].measuredAt).toISOString().slice(0, 10)}`
      : null,
    pet.weights.length > 1
      ? `Weight history: ${pet.weights
          .slice()
          .reverse()
          .map(
            (w) =>
              `${new Date(w.measuredAt).toISOString().slice(0, 10)}: ${w.weightLb}lb`
          )
          .join(", ")}`
      : null,
    pet.vaccinations.length > 0
      ? `Vaccinations: ${pet.vaccinations
          .map((v) => {
            const date = new Date(v.administeredAt).toISOString().slice(0, 10);
            const due = v.boosterDueAt
              ? `, booster due ${new Date(v.boosterDueAt).toISOString().slice(0, 10)}`
              : "";
            return `${v.name} on ${date}${due}`;
          })
          .join("; ")}`
      : "Vaccinations: none recorded",
    pet.vetVisits.length > 0
      ? `Recent vet visits: ${pet.vetVisits
          .map(
            (v) =>
              `${new Date(v.performedAt).toISOString().slice(0, 10)} — ${v.reason}`
          )
          .join("; ")}`
      : "Recent vet visits: none recorded",
    pet.notes ? `Owner notes: ${pet.notes.slice(0, 500)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  let items;
  try {
    items = await generateCoachItems(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "coach failed" },
      { status: 502 }
    );
  }

  // Replace any pending (incomplete, not-dismissed) recommendations with the new set.
  await prisma.recommendation.deleteMany({
    where: {
      petId: id,
      completedAt: null,
      dismissedAt: null,
    },
  });

  await prisma.recommendation.createMany({
    data: items.map((i, idx) => ({
      scope: "pet",
      petId: id,
      title: i.title,
      body: i.body ?? null,
      priority: i.priority ?? "normal",
      cadence: i.cadence ?? "one-time",
      position: idx,
    })),
  });

  const recommendations = await prisma.recommendation.findMany({
    where: { petId: id, completedAt: null, dismissedAt: null },
    orderBy: { position: "asc" },
  });

  return NextResponse.json({ recommendations });
}

function seasonOf(d: Date): string {
  // Northern hemisphere shorthand.
  const m = d.getMonth();
  if (m <= 1 || m === 11) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "autumn";
}
