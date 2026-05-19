import { prisma } from "@/lib/prisma";
import { FriendsList, type PersonRow } from "@/components/friends-list";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const people = await prisma.person.findMany({
    where: { userId, archived: false },
    orderBy: [
      { starred: "desc" },
      { lastInteractionAt: { sort: "asc", nulls: "first" } },
      { firstName: "asc" },
    ],
  });

  const rows: PersonRow[] = people.map((p) => ({
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
    lastInteractionAt: p.lastInteractionAt
      ? p.lastInteractionAt.toISOString()
      : null,
    notes: p.notes,
    imageUrl: p.imageUrl,
    starred: p.starred,
  }));

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
