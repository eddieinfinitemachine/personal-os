"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Car, Check, ChevronDown, Pencil, Wrench } from "lucide-react";
import {
  computeDue,
  DUE_SOON_DAYS,
  DUE_SOON_MILEAGE,
  formatRelativeDays,
  formatRelativeMiles,
  statusColor,
  type DueInfo,
  type DueStatus,
} from "@/lib/maintenance";
import { cn } from "@/lib/utils";

// Pick the figure that matches the row's status group: show the dimension
// (distance or time) actually driving "overdue"/"due soon" so an item that's
// late by date doesn't display a still-comfortable distance, and vice-versa.
// Coming-up rows stay distance-forward.
function dueLine(due: DueInfo, unit: string): string {
  const m = due.milesFromNow;
  const d = due.daysFromNow;
  if (due.status === "overdue") {
    if (m != null && m < 0) return formatRelativeMiles(m, unit);
    if (d != null && d < 0) return formatRelativeDays(d);
  } else if (due.status === "due-soon") {
    if (m != null && m >= 0 && m <= DUE_SOON_MILEAGE)
      return formatRelativeMiles(m, unit);
    if (d != null && d >= 0 && d <= DUE_SOON_DAYS) return formatRelativeDays(d);
  }
  if (m != null) return formatRelativeMiles(m, unit);
  if (d != null) return formatRelativeDays(d);
  return "—";
}

export type ServicingItem = {
  id: string;
  name: string;
  intervalMonths: number | null;
  intervalMileage: number | null;
  lastPerformedAt: string | null;
  lastPerformedMileage: number | null;
};

type Row = { item: ServicingItem; due: DueInfo };

const STATUS_RANK: Record<DueStatus, number> = {
  overdue: 0,
  "due-soon": 1,
  ok: 2,
  unknown: 3,
};

/**
 * Update the latest odometer reading and see, live, which servicing is due by
 * distance. Reuses computeDue() from lib/maintenance so it stays in lockstep
 * with the dashboard's per-item badges. Two layouts share one core:
 *   - "full"    → titled card on the vehicle dashboard (always expanded)
 *   - "compact" → slim Home widget (inline edit + "N due" pill, expandable)
 */
export function ServicingSummary({
  vehicleId,
  vehicleName,
  unit,
  currentMileage,
  items,
  variant = "full",
}: {
  vehicleId: string;
  vehicleName: string;
  unit: string;
  currentMileage: number | null;
  items: ServicingItem[];
  variant?: "full" | "compact";
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState(currentMileage?.toString() ?? "");
  const [editing, setEditing] = useState(variant === "full");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Live odometer value parsed from the input — drives the summary as you type.
  const raw = draft.replace(/[^\d]/g, "");
  const mileage = raw === "" ? null : Number(raw);
  const dirty = mileage !== currentMileage && raw !== "";

  const { overdue, dueSoon, comingUp, dueCount, worst } = useMemo(() => {
    const rows: Row[] = items.map((item) => ({
      item,
      due: computeDue(item, mileage),
    }));
    const byMiles = (a: Row, b: Row) =>
      (a.due.milesFromNow ?? a.due.daysFromNow ?? 0) -
      (b.due.milesFromNow ?? b.due.daysFromNow ?? 0);

    const overdue = rows.filter((r) => r.due.status === "overdue").sort(byMiles);
    const dueSoon = rows.filter((r) => r.due.status === "due-soon").sort(byMiles);
    const comingUp = rows
      .filter((r) => r.due.status === "ok" && r.item.intervalMileage != null)
      .sort(byMiles)
      .slice(0, 3);
    const dueCount = overdue.length + dueSoon.length;
    const worst: DueStatus =
      overdue.length > 0 ? "overdue" : dueSoon.length > 0 ? "due-soon" : "ok";
    return { overdue, dueSoon, comingUp, dueCount, worst };
  }, [items, mileage]);

  async function save() {
    if (mileage == null || !Number.isFinite(mileage) || mileage < 0) {
      setDraft(currentMileage?.toString() ?? "");
      if (variant === "compact") setEditing(false);
      return;
    }
    if (!dirty) {
      if (variant === "compact") setEditing(false);
      return;
    }
    setSaving(true);
    await fetch(`/api/vehicles/${vehicleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentMileage: mileage }),
    });
    setSaving(false);
    if (variant === "compact") setEditing(false);
    startTransition(() => router.refresh());
  }

  function odometerInput(big: boolean) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus={variant === "compact"}
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            else if (e.key === "Escape") {
              setDraft(currentMileage?.toString() ?? "");
              if (variant === "compact") setEditing(false);
            }
          }}
          onBlur={save}
          className={cn(
            "w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 tabular-nums focus:outline-none focus:border-[var(--color-ring)]",
            big ? "text-2xl font-bold" : "text-base font-semibold",
          )}
        />
        <span className="text-sm text-[var(--color-muted-foreground)]">{unit}</span>
        {dirty ? (
          <button
            onClick={save}
            disabled={saving}
            className="rounded-full p-1 text-emerald-500 hover:bg-[var(--color-accent)] disabled:opacity-50"
            title="Save odometer"
          >
            <Check className="size-4" />
          </button>
        ) : null}
      </div>
    );
  }

  const groups = (
    <div className="space-y-4">
      {dueCount === 0 && comingUp.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {items.length === 0
            ? "No service intervals set up yet."
            : mileage == null
              ? "Enter the current odometer to see what's due."
              : "All caught up — nothing due by distance or date."}
        </p>
      ) : null}
      {overdue.length > 0 ? (
        <Group label="Overdue" rows={overdue} unit={unit} mileage={mileage} />
      ) : null}
      {dueSoon.length > 0 ? (
        <Group label="Due soon" rows={dueSoon} unit={unit} mileage={mileage} />
      ) : null}
      {comingUp.length > 0 ? (
        <Group label="Coming up" rows={comingUp} unit={unit} mileage={mileage} />
      ) : null}
    </div>
  );

  if (variant === "compact") {
    const c = statusColor(worst);
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--color-accent)]">
            <Car className="size-4 text-[var(--color-muted-foreground)]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{vehicleName}</div>
            {editing ? (
              odometerInput(false)
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="group flex items-baseline gap-1.5 hover:opacity-80 transition"
                title="Update odometer"
              >
                <span className="text-base font-semibold tabular-nums">
                  {currentMileage != null ? currentMileage.toLocaleString() : "—"}
                </span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {unit}
                </span>
                <Pencil className="size-3 text-[var(--color-muted-foreground)] opacity-50 md:opacity-0 md:group-hover:opacity-100 transition" />
              </button>
            )}
          </div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
              c.bg,
              c.text,
            )}
            title="Show servicing"
          >
            {dueCount > 0 ? `${dueCount} due` : "All clear"}
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                expanded && "rotate-180",
              )}
            />
          </button>
        </div>
        {expanded ? <div className="mt-3">{groups}</div> : null}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Wrench className="size-4" /> Servicing — what&rsquo;s due now
        </h3>
        {dueCount > 0 ? (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
              statusColor(worst).bg,
              statusColor(worst).text,
            )}
          >
            {dueCount} due
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs text-[var(--color-muted-foreground)] uppercase tracking-wide">
          Update odometer
        </span>
        {odometerInput(true)}
      </div>
      {groups}
    </section>
  );
}

function Group({
  label,
  rows,
  unit,
  mileage,
}: {
  label: string;
  rows: Row[];
  unit: string;
  mileage: number | null;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        {label}
      </div>
      <ul className="space-y-1.5">
        {rows
          .slice()
          .sort((a, b) => STATUS_RANK[a.due.status] - STATUS_RANK[b.due.status])
          .map(({ item, due }) => {
            const c = statusColor(due.status);
            const distLine = dueLine(due, unit);
            const sinceLast =
              mileage != null && item.lastPerformedMileage != null
                ? `${(mileage - item.lastPerformedMileage).toLocaleString()} ${unit} since last`
                : null;
            return (
              <li
                key={item.id}
                className={cn("rounded-lg px-3 py-2 flex items-baseline justify-between gap-3", c.bg)}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{item.name}</div>
                  {sinceLast ? (
                    <div className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
                      {sinceLast}
                    </div>
                  ) : null}
                </div>
                <span className={cn("text-xs tabular-nums shrink-0", c.text)}>
                  {distLine}
                </span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
