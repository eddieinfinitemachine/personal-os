import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  TripItinerary,
  type TripDetail,
  type TripItemRow,
} from "@/components/trip-itinerary";
import { TripPacking, type PackingItemRow } from "@/components/trip-packing";
import { getSession } from "@/lib/auth";
import { isGmailConfigured } from "@/lib/google";
import { isFounderUser } from "@/lib/cron";

export const dynamic = "force-dynamic";

export default async function TripDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scan?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const { id } = await params;
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: [
          { startAt: { sort: "asc", nulls: "last" } },
          { position: "asc" },
        ],
      },
      packingItems: {
        orderBy: [{ category: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!trip) notFound();
  if (trip.userId !== userId) notFound();

  const gmailConfigured = isGmailConfigured() && (await isFounderUser(userId));
  const autoScan = gmailConfigured && (await searchParams).scan === "1";

  const detail: TripDetail = {
    id: trip.id,
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate ? trip.startDate.toISOString() : null,
    endDate: trip.endDate ? trip.endDate.toISOString() : null,
    status: trip.status,
    travelers: trip.travelers,
    transport: trip.transport,
    accommodation: trip.accommodation,
    costUsd: trip.costUsd,
    bookingUrl: trip.bookingUrl,
    notes: trip.notes,
    imageUrl: trip.imageUrl,
  };
  const items: TripItemRow[] = trip.items.map((it) => ({
    id: it.id,
    kind: it.kind,
    title: it.title,
    startAt: it.startAt ? it.startAt.toISOString() : null,
    endAt: it.endAt ? it.endAt.toISOString() : null,
    location: it.location,
    fromLocation: it.fromLocation,
    toLocation: it.toLocation,
    confirmation: it.confirmation,
    url: it.url,
    costUsd: it.costUsd,
    notes: it.notes,
    completedAt: it.completedAt ? it.completedAt.toISOString() : null,
  }));
  const packingItems: PackingItemRow[] = trip.packingItems.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category,
    quantity: p.quantity,
    notes: p.notes,
    packedAt: p.packedAt ? p.packedAt.toISOString() : null,
  }));

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <Link
        href="/trips"
        className="inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-3"
      >
        <ChevronLeft className="size-3.5" /> All trips
      </Link>
      <TripItinerary
        trip={detail}
        initialItems={items}
        gmailConfigured={gmailConfigured}
        autoScan={autoScan}
      />
      <div className="mt-4">
        <TripPacking
          tripId={trip.id}
          initialItems={packingItems}
          packingContext={trip.packingContext}
        />
      </div>
    </div>
  );
}
