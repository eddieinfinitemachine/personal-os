import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isFounderUser } from "@/lib/cron";
import { toPersonDTO } from "@/lib/dating-server";
import { pickAvatar } from "@/lib/dating-photos";
import { DatingHome, type DatingCard, type GranolaSuggestion } from "@/components/dating/dating-home";

export const dynamic = "force-dynamic";

export default async function DatingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const [people, events, pending, founder] = await Promise.all([
    prisma.datingPerson.findMany({
      where: { userId },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      include: { photos: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true } } },
    }),
    prisma.datingEvent.findMany({
      where: { userId },
      orderBy: { occurredAt: "asc" },
      select: { personId: true, kind: true, vibe: true, occurredAt: true },
    }),
    prisma.datingSuggestion.findMany({
      where: { userId, status: "pending", sourceRecordId: null },
      orderBy: { occurredAt: "desc" },
      select: { id: true, name: true, summary: true, title: true, url: true, occurredAt: true },
    }),
    isFounderUser(userId),
  ]);
  const suggestions: GranolaSuggestion[] = pending.map((s) => ({ ...s, occurredAt: s.occurredAt.toISOString() }));

  const eventsBy = new Map<string, typeof events>();
  for (const e of events) {
    const list = eventsBy.get(e.personId);
    if (list) list.push(e);
    else eventsBy.set(e.personId, [e]);
  }

  const cards: DatingCard[] = people.map(({ photos, ...p }) => {
    // Oldest first (see orderBy), so first/last are the ends of the range.
    const evs = eventsBy.get(p.id) ?? [];
    const dates = evs.filter((e) => e.kind === "date");
    const vibes = evs.flatMap((e) => (e.vibe ? [e.vibe] : []));
    const lastDate = dates.at(-1);
    return {
      ...toPersonDTO(p),
      dateCount: dates.length,
      avgVibe: vibes.length ? vibes.reduce((a, b) => a + b, 0) / vibes.length : null,
      avatarUrl: pickAvatar(photos),
      firstEventAt: evs[0]?.occurredAt.toISOString() ?? null,
      lastEventAt: evs.at(-1)?.occurredAt.toISOString() ?? null,
      lastDate: lastDate ? { at: lastDate.occurredAt.toISOString(), vibe: lastDate.vibe } : null,
    };
  });

  return <DatingHome people={cards} suggestions={suggestions} granola={founder} />;
}
