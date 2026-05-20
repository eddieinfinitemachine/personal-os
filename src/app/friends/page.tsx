import { prisma } from "@/lib/prisma";
import { FriendsList, type PersonRow } from "@/components/friends-list";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const [people, allInteractions] = await Promise.all([
    prisma.person.findMany({
      where: { userId, archived: false },
      orderBy: [
        { starred: "desc" },
        { lastInteractionAt: { sort: "asc", nulls: "first" } },
        { firstName: "asc" },
      ],
    }),
    // Pull all of this user's interactions sorted newest-first; we'll bucket
    // by personId in memory below. For Eddie's ~471 people / handful of
    // interactions this is trivial; if scale grows we'd switch to a window
    // function or denormalize the latest interaction onto Person.
    prisma.interaction.findMany({
      where: { userId },
      orderBy: { occurredAt: "desc" },
      select: { personIds: true, occurredAt: true, title: true, kind: true },
    }),
  ]);

  // For each person, find the most-recent interaction that includes them.
  const latestByPerson = new Map<
    string,
    { occurredAt: Date; title: string; kind: string }
  >();
  for (const i of allInteractions) {
    for (const pid of i.personIds) {
      if (!latestByPerson.has(pid)) {
        latestByPerson.set(pid, {
          occurredAt: i.occurredAt,
          title: i.title,
          kind: i.kind,
        });
      }
    }
  }

  const rows: PersonRow[] = people.map((p) => {
    const latest = latestByPerson.get(p.id);
    // Use whichever is newer: the cached lastInteractionAt or the actual
    // latest interaction. (Keeps display correct even if the cached field
    // drifts in the future.)
    const effectiveLastSeen =
      latest && (!p.lastInteractionAt || latest.occurredAt > p.lastInteractionAt)
        ? latest.occurredAt
        : p.lastInteractionAt;
    return {
      id: p.id,
      externalId: p.externalId,
      firstName: p.firstName,
      lastName: p.lastName,
      strength: p.strength,
      circles: p.circles,
      tags: p.tags,
      email: p.email,
      phone: p.phone,
      company: p.company,
      role: p.role,
      city: p.city,
      birthday: p.birthday ? p.birthday.toISOString() : null,
      lastInteractionAt: effectiveLastSeen ? effectiveLastSeen.toISOString() : null,
      lastInteractionTitle: latest?.title ?? null,
      lastInteractionKind: latest?.kind ?? null,
      createdAt: p.createdAt ? p.createdAt.toISOString() : null,
      notes: p.notes,
      imageUrl: p.imageUrl,
      starred: p.starred,
    };
  });

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Friends</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          People you care about. Check in regularly.
        </p>
      </header>
      <FriendsList initialPeople={rows} />
    </div>
  );
}
