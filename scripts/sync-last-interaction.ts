/**
 * One-shot: for every Person, set lastInteractionAt to the MAX(occurredAt) of
 * all Interaction rows that include that person in personIds. Never lowers
 * an existing value — only fills in / bumps forward.
 *
 *   pnpm dlx tsx scripts/sync-last-interaction.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Pull every interaction with its personIds + occurredAt. For 471 people
  // and a few thousand interactions this is trivial; if scale grows, switch
  // to a groupBy + unnest in SQL.
  const interactions = await prisma.interaction.findMany({
    select: { personIds: true, occurredAt: true, userId: true },
  });
  console.log(`Scanning ${interactions.length} interactions…`);

  // Compute MAX(occurredAt) per (userId, personId).
  const maxByPerson = new Map<string, Date>(); // key: `${userId}|${personId}`
  for (const i of interactions) {
    for (const pid of i.personIds) {
      const key = `${i.userId}|${pid}`;
      const cur = maxByPerson.get(key);
      if (!cur || i.occurredAt > cur) maxByPerson.set(key, i.occurredAt);
    }
  }
  console.log(`Found max interaction for ${maxByPerson.size} (user, person) pairs.`);

  let updated = 0;
  let unchanged = 0;
  for (const [key, occurredAt] of maxByPerson) {
    const [userId, personId] = key.split("|");
    const person = await prisma.person.findUnique({ where: { id: personId } });
    if (!person || person.userId !== userId) continue;
    // Only bump forward — never overwrite a newer cached value.
    if (person.lastInteractionAt && person.lastInteractionAt >= occurredAt) {
      unchanged++;
      continue;
    }
    await prisma.person.update({
      where: { id: personId },
      data: { lastInteractionAt: occurredAt },
    });
    updated++;
  }

  console.log(`\nBumped lastInteractionAt on ${updated} person rows.`);
  console.log(`Left ${unchanged} alone (already current).`);
  console.log(`Persons with no interactions are untouched.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
