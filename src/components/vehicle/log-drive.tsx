"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Plus, Trash2, X } from "lucide-react";

export type DriveLogEntry = {
  id: string;
  drivenAt: string | Date;
  distance: number;
  destination: string | null;
  notes: string | null;
};

export function LogDrive({
  vehicleId,
  unit,
  drives,
}: {
  vehicleId: string;
  unit: string;
  drives: DriveLogEntry[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [drivenAt, setDrivenAt] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [distance, setDistance] = useState("");
  const [destination, setDestination] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  function reset() {
    setDrivenAt(new Date().toISOString().slice(0, 10));
    setDistance("");
    setDestination("");
    setNotes("");
  }
  function close() {
    setOpen(false);
    reset();
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const n = Number(distance.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/drives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distance: Math.round(n),
          drivenAt: new Date(drivenAt).toISOString(),
          destination: destination.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      if (res.ok) {
        close();
        startTransition(() => router.refresh());
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(driveId: string) {
    await fetch(`/api/vehicles/${vehicleId}/drives/${driveId}`, {
      method: "DELETE",
    });
    startTransition(() => router.refresh());
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Drives</h3>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--color-tint)] text-white px-3 py-1.5 text-xs font-medium hover:opacity-90 transition"
        >
          <Plus className="size-3.5" />
          Log drive
        </button>
      </div>

      {drives.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          No drives logged yet. Tap “Log drive” after each outing — distance
          gets added to the odometer and the maintenance coach uses your history.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {drives.map((d) => {
            const date = new Date(d.drivenAt);
            return (
              <li
                key={d.id}
                className="group py-2.5 flex items-start gap-3 text-sm"
              >
                <div className="w-20 shrink-0 text-xs text-[var(--color-muted-foreground)] tabular-nums">
                  {date.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold tabular-nums">
                      {d.distance.toLocaleString()} {unit}
                    </span>
                    {d.destination ? (
                      <span className="inline-flex items-center gap-1 text-[var(--color-muted-foreground)] truncate">
                        <MapPin className="size-3 shrink-0" />
                        <span className="truncate">{d.destination}</span>
                      </span>
                    ) : null}
                  </div>
                  {d.notes ? (
                    <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5 line-clamp-2">
                      {d.notes}
                    </div>
                  ) : null}
                </div>
                <button
                  onClick={() => remove(d.id)}
                  className="opacity-0 group-hover:opacity-50 hover:!opacity-100 transition p-1 rounded text-rose-500"
                  title="Delete drive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <form
            onSubmit={submit}
            className="w-full md:max-w-md rounded-t-2xl md:rounded-2xl bg-[var(--color-card)] border-t md:border border-[var(--color-border)] shadow-2xl pb-[max(env(safe-area-inset-bottom),16px)]"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
              <div className="font-semibold">Log a drive</div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded p-1 hover:bg-[var(--color-accent)]"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <Field label={`Distance (${unit})`}>
                <input
                  autoFocus
                  inputMode="numeric"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  placeholder="e.g. 42"
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-base tabular-nums focus:outline-none focus:border-[var(--color-ring)]"
                />
              </Field>
              <Field label="Where did you go?">
                <input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="optional — e.g. Greenwich → Westport"
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-ring)]"
                />
              </Field>
              <Field label="Date">
                <input
                  type="date"
                  value={drivenAt}
                  onChange={(e) => setDrivenAt(e.target.value)}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-ring)]"
                />
              </Field>
              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="optional — weather, route, anything to flag"
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-ring)] resize-none"
                />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pt-2">
              <button
                type="button"
                onClick={close}
                className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-accent)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !distance.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Save drive
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[var(--color-muted-foreground)] mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}
