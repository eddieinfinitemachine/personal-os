import Link from "next/link";
import { Car } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { AddVehicleButton } from "@/components/add-vehicle-button";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function VehiclesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const projects = await prisma.project.findMany({
    where: { userId, kind: "vehicle", archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      vehicle: {
        include: {
          photos: { orderBy: { position: "asc" }, take: 1 },
          serviceItems: true,
        },
      },
    },
  });

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehicles</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            The garage. {projects.length} total.
          </p>
        </div>
        <AddVehicleButton />
      </header>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => {
          const v = p.vehicle;
          const heroPhoto = v?.photos[0];
          return (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden hover:bg-[var(--color-accent)]/40 transition"
            >
              <div className="aspect-[4/3] bg-[var(--color-muted)] relative">
                {heroPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={heroPhoto.url}
                    alt={p.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-[var(--color-muted-foreground)]">
                    <Car className="size-10 opacity-40" />
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="font-semibold tracking-tight">{p.name}</div>
                {v ? (
                  <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                    {v.year} {v.make} {v.model}
                    {v.exteriorColor ? ` · ${v.exteriorColor}` : ""}
                  </div>
                ) : null}
                <div className="mt-2 flex items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
                  {v?.currentMileage != null ? (
                    <span className="tabular-nums">
                      {v.currentMileage.toLocaleString()} {v.mileageUnit}
                    </span>
                  ) : null}
                  {v ? (
                    <span>{v.serviceItems.length} service items</span>
                  ) : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
