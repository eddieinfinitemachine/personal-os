/**
 * Tag every user's untagged mood board items with Claude (same logic as
 * POST /api/board/tags/backfill, but for all users and without a time limit).
 *
 * Run with: npx tsx --env-file=.env scripts/backfill-board-tags.ts
 *
 * Idempotent: only touches items whose `tags` is empty.
 */
import { prisma } from "../src/lib/prisma";
import { backfillTags } from "../src/lib/board-tags";

async function main() {
  const users = await prisma.boardItem.groupBy({
    by: ["userId"],
    where: { tags: { isEmpty: true } },
    _count: { _all: true },
  });
  console.log(`${users.length} user(s) with untagged items`);
  for (const u of users) {
    console.log(`\n${u.userId}: ${u._count._all} untagged`);
    let total = 0;
    const skip: string[] = [];
    for (;;) {
      const { tagged, remaining, failed } = await backfillTags(u.userId, { limit: 40, skip });
      total += tagged;
      skip.push(...failed);
      console.log(`  tagged ${tagged}, ${remaining} remaining`);
      // Done when everything left is something that already failed once.
      if (remaining <= skip.length || (!tagged && !failed.length)) break;
    }
    console.log(`  done: ${total} tagged, ${skip.length} failed`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
