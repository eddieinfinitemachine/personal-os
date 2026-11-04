import Link from "next/link";
import Image from "next/image";
import { PawPrint } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The Pets tracker: one card per pet, each opening its dashboard. */
export default async function PetsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const projects = await prisma.project.findMany({
    where: { userId, kind: "pet", archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      pet: {
        include: {
          photos: { orderBy: { position: "asc" }, take: 1 },
        },
      },
    },
  });

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6">
        <h1 className="text-large-title font-bold">Pets</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Weight, vaccinations and vet visits. {projects.length} total.
        </p>
      </header>

      {projects.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">No pets yet.</p>
      ) : null}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p, i) => {
          const pet = p.pet;
          const heroPhoto = pet?.photos[0];
          const detail = pet ? [pet.species, pet.breed].filter(Boolean).join(" · ") : "";
          return (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden hover:bg-[var(--color-accent)]/40 transition"
            >
              <div className="aspect-[4/3] bg-[var(--color-muted)] relative">
                {heroPhoto ? (
                  <Image
                    src={heroPhoto.url}
                    alt={pet?.name ?? p.name}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover"
                    priority={i === 0}
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-[var(--color-muted-foreground)]">
                    <PawPrint className="size-10 opacity-40" />
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="font-semibold tracking-tight">{pet?.name ?? p.name}</div>
                {detail ? (
                  <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5 capitalize">
                    {detail}
                  </div>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
