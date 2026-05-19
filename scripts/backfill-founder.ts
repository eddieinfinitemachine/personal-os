/**
 * One-time backfill: assign all existing rows to a founder user.
 *
 * Run with: pnpm tsx scripts/backfill-founder.ts
 *
 * Idempotent — safe to re-run. Only touches rows where userId IS NULL.
 */
import { PrismaClient } from "@prisma/client";

const FOUNDER_EMAIL =
  process.env.FOUNDER_EMAIL?.toLowerCase().trim() ?? "emcohen@me.com";

const prisma = new PrismaClient({ log: ["error", "warn"] });

async function main() {
  console.log(`Backfilling all rows to founder: ${FOUNDER_EMAIL}`);

  const founder = await prisma.user.upsert({
    where: { email: FOUNDER_EMAIL },
    update: {},
    create: { email: FOUNDER_EMAIL, name: "Eddie" },
  });
  console.log(`✓ Founder user: ${founder.id}`);

  // Every user-scoped model — keep in sync with schema.prisma.
  const tables = [
    "Trip",
    "TripItem",
    "List",
    "Project",
    "Vehicle",
    "VehiclePhoto",
    "ShoppingItem",
    "Human",
    "BiometricReading",
    "LabResult",
    "MedicalVisit",
    "HumanVaccination",
    "FitnessSession",
    "DnaResult",
    "Pet",
    "PetWeight",
    "PetVaccination",
    "PetVetVisit",
    "PetPhoto",
    "Recommendation",
    "PetShoppingItem",
    "ServiceItem",
    "ServiceRecord",
    "VehicleContact",
    "VehicleDrive",
    "Note",
    "Attachment",
    "Person",
    "Asset",
    "Todo",
  ];

  for (const table of tables) {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "userId" = $1 WHERE "userId" IS NULL`,
      founder.id,
    );
    console.log(`  ${table.padEnd(22)} updated ${result} rows`);
  }

  console.log("\nBackfill complete. Next: flip userId to required in schema.prisma and `prisma db push`.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
