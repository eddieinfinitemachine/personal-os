import { prisma } from "@/lib/prisma";
import { toPersonDTO, type DatingPersonDTO } from "@/lib/dating-server";
import { pickAvatar } from "@/lib/dating-photos";

/** A person on the /dating overview: the profile plus what its card shows. */
export type DatingCard = DatingPersonDTO & {
  dateCount: number;
  avgVibe: number | null;
  /** Newest private photo, shown as a small round avatar. */
  avatarUrl: string | null;
  firstEventAt: string | null;
  lastEventAt: string | null;
  lastDate: { at: string; vibe: number | null } | null;
};

/**
 * Everyone on the overview, most recent text first. Shared by the /dating
 * page and GET /api/dating (the native app), so both show the same cards.
 */
export async function datingCards(userId: string): Promise<DatingCard[]> {
  const [people, events] = await Promise.all([
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
  ]);

  const eventsBy = new Map<string, typeof events>();
  for (const e of events) {
    const list = eventsBy.get(e.personId);
    if (list) list.push(e);
    else eventsBy.set(e.personId, [e]);
  }

  return people.map(({ photos, ...p }) => {
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
}
