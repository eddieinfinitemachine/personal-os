"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCalendarDate } from "@/lib/utils";
import {
  Bed,
  Calendar,
  Check,
  CheckSquare,
  Coffee,
  Compass,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  Plane,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type TripDetail = {
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

export type TripItemRow = {
  id: string;
  kind: string;
  title: string;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  confirmation: string | null;
  url: string | null;
  costUsd: number | null;
  notes: string | null;
  completedAt: string | null;
};

const SECTIONS: Array<{
  kind: string;
  label: string;
  Icon: typeof Plane;
  cta: string;
}> = [
  { kind: "task", label: "Tasks", Icon: CheckSquare, cta: "Add task" },
  { kind: "flight", label: "Flights", Icon: Plane, cta: "Add flight" },
  { kind: "lodging", label: "Lodging", Icon: Bed, cta: "Add stay" },
  { kind: "activity", label: "Activities", Icon: Compass, cta: "Add activity" },
  { kind: "transport", label: "Ground transport", Icon: MapPin, cta: "Add transport" },
  { kind: "meal", label: "Meals", Icon: Coffee, cta: "Add meal" },
  { kind: "note", label: "Notes", Icon: Pencil, cta: "Add note" },
];

const STATUS_STYLES: Record<string, string> = {
  planned: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  booked: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  past: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  cancelled: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
};

function fmtRange(start: string | null, end: string | null) {
  if (!start && !end) return null;
  // Trip start/end are date-only (UTC midnight) — format in UTC so they don't
  // slip a day in timezones west of UTC. See lib/utils formatCalendarDate.
  const toShort = (iso: string) =>
    formatCalendarDate(iso, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  if (start && end) return `${toShort(start)} → ${toShort(end)}`;
  if (start) return `from ${toShort(start)}`;
  if (end) return `until ${toShort(end!)}`;
  return null;
}

function fmtWhen(start: string | null, end: string | null) {
  if (!start && !end) return null;
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  const toS = (iso: string) => new Date(iso).toLocaleString(undefined, opts);
  if (start && end) return `${toS(start)} → ${toS(end)}`;
  if (start) return toS(start);
  return toS(end!);
}

export function TripItinerary({
  trip: initialTrip,
  initialItems,
}: {
  trip: TripDetail;
  initialItems: TripItemRow[];
}) {
  const router = useRouter();
  const [trip, setTrip] = useState(initialTrip);
  const [items, setItems] = useState(initialItems);
  const [editingTrip, setEditingTrip] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<TripItemRow | null>(null);

  const range = fmtRange(trip.startDate, trip.endDate);

  const grouped = useMemo(() => {
    const map = new Map<string, TripItemRow[]>();
    for (const it of items) {
      const arr = map.get(it.kind) ?? [];
      arr.push(it);
      map.set(it.kind, arr);
    }
    return map;
  }, [items]);

  return (
    <>
      <header className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                {trip.name}
              </h1>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  STATUS_STYLES[trip.status] ?? STATUS_STYLES.planned
                )}
              >
                {trip.status}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-muted-foreground)]">
              {trip.destination ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {trip.destination}
                </span>
              ) : null}
              {range ? (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="size-3.5" />
                  {range}
                </span>
              ) : null}
              {trip.travelers.length > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5" />
                  {trip.travelers.join(", ")}
                </span>
              ) : null}
              {trip.costUsd != null ? (
                <span className="tabular-nums">
                  ${trip.costUsd.toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>
          <button
            onClick={() => setEditingTrip(true)}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-accent)] inline-flex items-center gap-1.5"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
        </div>
      </header>

      <div className="space-y-5">
        {SECTIONS.map(({ kind, label, Icon, cta }) => {
          const list = grouped.get(kind) ?? [];
          if (kind === "task") {
            return (
              <TaskSection
                key={kind}
                tripId={trip.id}
                items={list}
                onAdded={(item) => setItems((prev) => [...prev, item])}
                onUpdated={(item) =>
                  setItems((prev) =>
                    prev.map((p) => (p.id === item.id ? item : p))
                  )
                }
                onRowClick={(it) => setEditingItem(it)}
              />
            );
          }
          return (
            <section
              key={kind}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]"
            >
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-[var(--color-muted-foreground)]" />
                  <h2 className="text-sm font-semibold tracking-tight">
                    {label}
                  </h2>
                  {list.length > 0 ? (
                    <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
                      {list.length}
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={() => setAdding(kind)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                >
                  <Plus className="size-3.5" />
                  {cta}
                </button>
              </div>
              {list.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-[var(--color-muted-foreground)]">
                  Nothing here yet.
                </div>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {list.map((it) => (
                    <li
                      key={it.id}
                      onClick={() => setEditingItem(it)}
                      className="cursor-pointer px-4 py-3 hover:bg-[var(--color-accent)]/40 transition"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{it.title}</div>
                          <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)] space-y-0.5">
                            {it.fromLocation || it.toLocation ? (
                              <div className="truncate">
                                {it.fromLocation ?? "?"} →{" "}
                                {it.toLocation ?? "?"}
                              </div>
                            ) : it.location ? (
                              <div className="truncate">{it.location}</div>
                            ) : null}
                            {(it.startAt || it.endAt) ? (
                              <div>{fmtWhen(it.startAt, it.endAt)}</div>
                            ) : null}
                            {it.confirmation ? (
                              <div className="font-mono">
                                {it.confirmation}
                              </div>
                            ) : null}
                            {it.notes ? (
                              <div className="line-clamp-2">{it.notes}</div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 text-xs text-[var(--color-muted-foreground)] tabular-nums">
                          {it.costUsd != null ? (
                            <span>${it.costUsd.toLocaleString()}</span>
                          ) : null}
                          {it.url ? (
                            <a
                              href={it.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 hover:text-[var(--color-foreground)]"
                            >
                              <ExternalLink className="size-3" />
                              open
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {trip.notes ? (
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <h2 className="text-sm font-semibold tracking-tight mb-2">
              Trip notes
            </h2>
            <div className="text-sm whitespace-pre-wrap text-[var(--color-muted-foreground)]">
              {trip.notes}
            </div>
          </section>
        ) : null}
      </div>

      {adding ? (
        <ItemEditor
          tripId={trip.id}
          kind={adding}
          onClose={() => setAdding(null)}
          onCreated={(item) => {
            setItems((prev) => [...prev, item]);
            setAdding(null);
            router.refresh();
          }}
        />
      ) : null}

      {editingItem ? (
        <ItemEditor
          tripId={trip.id}
          kind={editingItem.kind}
          existing={editingItem}
          onClose={() => setEditingItem(null)}
          onCreated={(item) => {
            setItems((prev) =>
              prev.map((p) => (p.id === item.id ? item : p))
            );
            setEditingItem(null);
            router.refresh();
          }}
          onDeleted={(id) => {
            setItems((prev) => prev.filter((p) => p.id !== id));
            setEditingItem(null);
            router.refresh();
          }}
        />
      ) : null}

      {editingTrip ? (
        <TripEditor
          trip={trip}
          onClose={() => setEditingTrip(false)}
          onSaved={(updated) => {
            setTrip(updated);
            setEditingTrip(false);
            router.refresh();
          }}
          onDeleted={() => {
            router.push("/trips");
          }}
        />
      ) : null}
    </>
  );
}

function TaskSection({
  tripId,
  items,
  onAdded,
  onUpdated,
  onRowClick,
}: {
  tripId: string;
  items: TripItemRow[];
  onAdded: (item: TripItemRow) => void;
  onUpdated: (item: TripItemRow) => void;
  onRowClick: (item: TripItemRow) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        const ac = a.completedAt ? 1 : 0;
        const bc = b.completedAt ? 1 : 0;
        return ac - bc;
      }),
    [items]
  );
  const openCount = items.filter((i) => !i.completedAt).length;

  async function addTask() {
    const title = draft.trim();
    if (!title || saving) return;
    setSaving(true);
    const res = await fetch(`/api/trips/${tripId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "task", title }),
    });
    setSaving(false);
    if (res.ok) {
      const data = (await res.json()) as { item: TripItemRow };
      onAdded({ ...data.item, completedAt: data.item.completedAt ?? null });
      setDraft("");
    }
  }

  async function toggle(item: TripItemRow) {
    const next = item.completedAt ? null : new Date().toISOString();
    onUpdated({ ...item, completedAt: next });
    await fetch(`/api/trips/${tripId}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggleComplete: true }),
    });
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <CheckSquare className="size-4 text-[var(--color-muted-foreground)]" />
          <h2 className="text-sm font-semibold tracking-tight">Tasks</h2>
          {items.length > 0 ? (
            <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
              {openCount} open · {items.length} total
            </span>
          ) : null}
        </div>
      </div>
      <div className="p-4 space-y-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addTask();
          }}
          className="flex items-center gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a task — book flights, pack passport…"
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none min-h-[40px]"
          />
          <button
            type="submit"
            disabled={saving || !draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50 min-h-[36px]"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add
          </button>
        </form>
        {sorted.length === 0 ? null : (
          <ul className="space-y-px -mx-1">
            {sorted.map((it) => {
              const done = !!it.completedAt;
              return (
                <li
                  key={it.id}
                  className="group flex items-start gap-3 px-1 py-2 rounded hover:bg-[var(--color-accent)]/40 transition"
                >
                  <button
                    onClick={() => toggle(it)}
                    className={cn(
                      "mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full border-2 transition",
                      done
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "border-[var(--color-muted-foreground)]/40 hover:border-emerald-500"
                    )}
                    title={done ? "Mark incomplete" : "Mark complete"}
                  >
                    {done ? <Check className="size-3" /> : null}
                  </button>
                  <button
                    onClick={() => onRowClick(it)}
                    className={cn(
                      "flex-1 min-w-0 text-left text-sm",
                      done && "line-through text-[var(--color-muted-foreground)]"
                    )}
                  >
                    {it.title}
                    {it.notes ? (
                      <div className="text-xs text-[var(--color-muted-foreground)] line-clamp-1">
                        {it.notes}
                      </div>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function ItemEditor({
  tripId,
  kind,
  existing,
  onClose,
  onCreated,
  onDeleted,
}: {
  tripId: string;
  kind: string;
  existing?: TripItemRow;
  onClose: () => void;
  onCreated: (item: TripItemRow) => void;
  onDeleted?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<TripItemRow>(
    existing ?? {
      id: "",
      kind,
      title: "",
      startAt: null,
      endAt: null,
      location: null,
      fromLocation: null,
      toLocation: null,
      confirmation: null,
      url: null,
      costUsd: null,
      notes: null,
      completedAt: null,
    }
  );
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const showFromTo = kind === "flight" || kind === "transport";
  const showLocation = !showFromTo && kind !== "note";

  const dtValue = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  async function save() {
    setSaving(true);
    const payload = {
      kind: draft.kind,
      title: draft.title.trim(),
      startAt: draft.startAt,
      endAt: draft.endAt,
      location: draft.location,
      fromLocation: draft.fromLocation,
      toLocation: draft.toLocation,
      confirmation: draft.confirmation,
      url: draft.url,
      costUsd: draft.costUsd,
      notes: draft.notes,
    };
    const url = existing
      ? `/api/trips/${tripId}/items/${existing.id}`
      : `/api/trips/${tripId}/items`;
    const res = await fetch(url, {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      const data = (await res.json()) as { item: TripItemRow };
      onCreated(data.item);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!confirm(`Delete "${existing.title}"?`)) return;
    setBusy(true);
    const res = await fetch(
      `/api/trips/${tripId}/items/${existing.id}`,
      { method: "DELETE" }
    );
    setBusy(false);
    if (res.ok && onDeleted) onDeleted(existing.id);
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/60 p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border-t sm:border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl max-h-[95vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="sticky top-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="text-sm font-semibold capitalize">
            {existing ? "Edit" : "New"} {kind}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-[var(--color-accent)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-3 grid-cols-2 p-5">
          <Field label="Title *" full>
            <Input
              value={draft.title}
              placeholder={
                kind === "flight"
                  ? "United UA901"
                  : kind === "lodging"
                    ? "Mandarin Oriental"
                    : kind === "activity"
                      ? "Wedding ceremony"
                      : "Title"
              }
              onChange={(v) => setDraft((d) => ({ ...d, title: v }))}
            />
          </Field>
          {showFromTo ? (
            <>
              <Field label="From">
                <Input
                  value={draft.fromLocation ?? ""}
                  placeholder="JFK"
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, fromLocation: v || null }))
                  }
                />
              </Field>
              <Field label="To">
                <Input
                  value={draft.toLocation ?? ""}
                  placeholder="MAN"
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, toLocation: v || null }))
                  }
                />
              </Field>
            </>
          ) : showLocation ? (
            <Field label="Location" full>
              <Input
                value={draft.location ?? ""}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, location: v || null }))
                }
              />
            </Field>
          ) : null}
          <Field label={kind === "lodging" ? "Check-in" : "Start"}>
            <Input
              type="datetime-local"
              value={dtValue(draft.startAt)}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  startAt: v ? new Date(v).toISOString() : null,
                }))
              }
            />
          </Field>
          <Field label={kind === "lodging" ? "Check-out" : "End"}>
            <Input
              type="datetime-local"
              value={dtValue(draft.endAt)}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  endAt: v ? new Date(v).toISOString() : null,
                }))
              }
            />
          </Field>
          <Field label="Confirmation #">
            <Input
              value={draft.confirmation ?? ""}
              placeholder="ABC123"
              onChange={(v) =>
                setDraft((d) => ({ ...d, confirmation: v || null }))
              }
            />
          </Field>
          <Field label="Cost ($)">
            <Input
              type="number"
              value={draft.costUsd != null ? String(draft.costUsd) : ""}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  costUsd: v ? Number(v) : null,
                }))
              }
            />
          </Field>
          <Field label="URL" full>
            <Input
              value={draft.url ?? ""}
              placeholder="https://…"
              onChange={(v) => setDraft((d) => ({ ...d, url: v || null }))}
            />
          </Field>
          <Field label="Notes" full>
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, notes: e.target.value || null }))
              }
              rows={3}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none"
            />
          </Field>
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-card)]">
          {existing ? (
            <button
              onClick={remove}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-accent)]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !draft.title.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {existing ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TripEditor({
  trip,
  onClose,
  onSaved,
  onDeleted,
}: {
  trip: TripDetail;
  onClose: () => void;
  onSaved: (t: TripDetail) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<TripDetail>(trip);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        destination: draft.destination,
        startDate: draft.startDate,
        endDate: draft.endDate,
        status: draft.status,
        travelers: draft.travelers,
        transport: draft.transport,
        accommodation: draft.accommodation,
        costUsd: draft.costUsd,
        bookingUrl: draft.bookingUrl,
        notes: draft.notes,
      }),
    });
    setSaving(false);
    if (res.ok) onSaved(draft);
  }

  async function remove() {
    if (!confirm(`Delete "${trip.name}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/trips/${trip.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) onDeleted();
  }

  const dateValue = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/60 p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border-t sm:border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl max-h-[95vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="sticky top-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="text-sm font-semibold">Edit trip</div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-[var(--color-accent)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-3 grid-cols-2 p-5">
          <Field label="Name" full>
            <Input
              value={draft.name}
              onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
            />
          </Field>
          <Field label="Destination" full>
            <Input
              value={draft.destination ?? ""}
              onChange={(v) =>
                setDraft((d) => ({ ...d, destination: v || null }))
              }
            />
          </Field>
          <Field label="Start">
            <Input
              type="date"
              value={dateValue(draft.startDate)}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  startDate: v ? new Date(v).toISOString() : null,
                }))
              }
            />
          </Field>
          <Field label="End">
            <Input
              type="date"
              value={dateValue(draft.endDate)}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  endDate: v ? new Date(v).toISOString() : null,
                }))
              }
            />
          </Field>
          <Field label="Status">
            <select
              value={draft.status}
              onChange={(e) =>
                setDraft((d) => ({ ...d, status: e.target.value }))
              }
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm min-h-[40px]"
            >
              <option value="planned">Planned</option>
              <option value="booked">Booked</option>
              <option value="active">Active</option>
              <option value="past">Past</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
          <Field label="Cost ($)">
            <Input
              type="number"
              value={draft.costUsd != null ? String(draft.costUsd) : ""}
              onChange={(v) =>
                setDraft((d) => ({ ...d, costUsd: v ? Number(v) : null }))
              }
            />
          </Field>
          <Field label="Travelers (comma separated)" full>
            <Input
              value={draft.travelers.join(", ")}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  travelers: v
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }))
              }
            />
          </Field>
          <Field label="Trip notes" full>
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, notes: e.target.value || null }))
              }
              rows={4}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none"
            />
          </Field>
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-card)]">
          <button
            onClick={remove}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            Delete
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-accent)]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !draft.name.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "col-span-2" : undefined}>
      <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  type,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  const isDateLike =
    type === "date" || type === "datetime-local" || type === "time";
  return (
    <input
      type={type ?? "text"}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onFocus={
        isDateLike
          ? (e) => {
              try {
                (e.currentTarget as HTMLInputElement).showPicker?.();
              } catch {}
            }
          : undefined
      }
      onClick={
        isDateLike
          ? (e) => {
              try {
                (e.currentTarget as HTMLInputElement).showPicker?.();
              } catch {}
            }
          : undefined
      }
      className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none min-h-[40px]"
    />
  );
}
