import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isFounderUser } from "@/lib/cron";
import { weekStart } from "@/lib/dating";
import { toPersonDTO } from "@/lib/dating-server";
import { DatingHome, type DatingCard, type GranolaSuggestion } from "@/components/dating/dating-home";

export const dynamic = "force-dynamic";

const SPARK_WEEKS = 12;

export default async function DatingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const sparkStart = weekStart(new Date());
  sparkStart.setDate(sparkStart.getDate() - 7 * (SPARK_WEEKS - 1));

  const [people, counts, events, recent, pending, founder] = await Promise.all([
    prisma.datingPerson.findMany({
      where: { userId },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    }),
    prisma.datingMessage.groupBy({ by: ["personId"], where: { userId }, _count: { _all: true } }),
    prisma.datingEvent.findMany({ where: { userId }, select: { personId: true, kind: true, vibe: true } }),
    prisma.datingMessage.findMany({
      where: { userId, sentAt: { gte: sparkStart } },
      select: { personId: true, sentAt: true },
    }),
    prisma.datingSuggestion.findMany({
      where: { userId, status: "pending" },
      orderBy: { occurredAt: "desc" },
      select: { id: true, name: true, summary: true, title: true, url: true, occurredAt: true },
    }),
    isFounderUser(userId),
  ]);
  const suggestions: GranolaSuggestion[] = pending.map((s) => ({ ...s, occurredAt: s.occurredAt.toISOString() }));

  const countBy = new Map(counts.map((c) => [c.personId, c._count._all]));
  const cards: DatingCard[] = people.map((p) => {
    const evs = events.filter((e) => e.personId === p.id);
    const vibes = evs.flatMap((e) => (e.vibe ? [e.vibe] : []));
    const spark = Array<number>(SPARK_WEEKS).fill(0);
    for (const m of recent) {
      if (m.personId !== p.id) continue;
      const i = Math.floor((weekStart(m.sentAt).getTime() - sparkStart.getTime()) / (7 * 86_400_000));
      if (i >= 0 && i < SPARK_WEEKS) spark[i]++;
    }
    return {
      ...toPersonDTO(p),
      messageCount: countBy.get(p.id) ?? 0,
      dateCount: evs.filter((e) => e.kind === "date").length,
      avgVibe: vibes.length ? vibes.reduce((a, b) => a + b, 0) / vibes.length : null,
      spark,
    };
  });

  return <DatingHome people={cards} suggestions={suggestions} granola={founder} />;
}
