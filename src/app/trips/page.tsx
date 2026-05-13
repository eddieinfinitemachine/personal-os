import { prisma } from "@/lib/prisma";
import { AddTripButton } from "@/components/add-trip-button";
import { TripsList, type TripRow } from "@/components/trips-list";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const trips = await prisma.trip.findMany({
    where: { archived: false },
    orderBy: [
      { startDate: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
  });

  const rows: TripRow[] = trips.map((t) => ({
    id: t.id,
    name: t.name,
    destination: t.destination,
    startDate: t.startDate ? t.startDate.toISOString() : null,
    endDate: t.endDate ? t.endDate.toISOString() : null,
    status: t.status,
    travelers: t.travelers,
    transport: t.transport,
    accommodation: t.accommodation,
    costUsd: t.costUsd,
    bookingUrl: t.bookingUrl,
    notes: t.notes,
    imageUrl: t.imageUrl,
  }));

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trips</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Where you&apos;re going. {trips.length} total.
          </p>
        </div>
        <AddTripButton />
      </header>

      <TripsList initialTrips={rows} />
    </div>
  );
}
