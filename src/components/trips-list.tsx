"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Calendar, MapPin, Plane, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type TripRow = {
  id: string;
  name: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  travelers: string[];
  transport: string | null;
  accommodation: string | null;
  costUsd: number | null;
  bookingUrl: string | null;
  notes: string | null;
  imageUrl: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  planned: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  booked: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  past: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  cancelled: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
};

function fmtRange(start: string | null, end: string | null) {
  if (!start && !end) return null;
  const toShort = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  if (start && end) return `${toShort(start)} → ${toShort(end)}`;
  if (start) return `from ${toShort(start)}`;
  if (end) return `until ${toShort(end!)}`;
  return null;
}

export function TripsList({ initialTrips }: { initialTrips: TripRow[] }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    if (statusFilter === "all") return initialTrips;
    return initialTrips.filter((t) => t.status === statusFilter);
  }, [initialTrips, statusFilter]);

  const filters = [
    { key: "all", label: "All" },
    { key: "planned", label: "Planned" },
    { key: "booked", label: "Booked" },
    { key: "active", label: "Active" },
    { key: "past", label: "Past" },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              statusFilter === f.key
                ? "border-[var(--color-foreground)] bg-[var(--color-foreground)] text-[var(--color-background)]"
                : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-muted-foreground)]">
          No trips yet. Tap{" "}
          <span className="font-medium text-[var(--color-foreground)]">
            Add trip
          </span>{" "}
          to plan one.
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => {
            const range = fmtRange(t.startDate, t.endDate);
            return (
              <Link
                key={t.id}
                href={`/trips/${t.id}`}
                className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden hover:bg-[var(--color-accent)]/40 transition"
              >
                <div className="aspect-[16/9] bg-[var(--color-muted)] relative">
                  {t.imageUrl ? (
                    <Image
                      src={t.imageUrl}
                      alt={t.name}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="object-cover"
                      priority={filtered.indexOf(t) === 0}
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-[var(--color-muted-foreground)]">
                      <Plane className="size-10 opacity-40" />
                    </div>
                  )}
                  <span
                    className={cn(
                      "absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      STATUS_STYLES[t.status] ?? STATUS_STYLES.planned
                    )}
                  >
                    {t.status}
                  </span>
                </div>
                <div className="p-4 space-y-1">
                  <div className="font-semibold tracking-tight">{t.name}</div>
                  {t.destination ? (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                      <MapPin className="size-3" />
                      <span className="truncate">{t.destination}</span>
                    </div>
                  ) : null}
                  {range ? (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                      <Calendar className="size-3" />
                      <span>{range}</span>
                    </div>
                  ) : null}
                  {t.travelers.length > 0 ? (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                      <Users className="size-3" />
                      <span className="truncate">
                        {t.travelers.join(", ")}
                      </span>
                    </div>
                  ) : null}
                  {t.costUsd != null ? (
                    <div className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
                      ${t.costUsd.toLocaleString()}
                    </div>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
