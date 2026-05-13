"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";

export function AddTripButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({
    status: "planned",
  });

  async function submit() {
    const name = draft.name?.trim();
    if (!name) return;
    setSaving(true);
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        destination: draft.destination || null,
        startDate: draft.startDate || null,
        endDate: draft.endDate || null,
        status: draft.status || "planned",
        travelers: draft.travelers
          ? draft.travelers
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        transport: draft.transport || null,
        accommodation: draft.accommodation || null,
        costUsd: draft.costUsd ? Number(draft.costUsd) : null,
        bookingUrl: draft.bookingUrl || null,
        notes: draft.notes || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      setDraft({ status: "planned" });
      router.refresh();
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium min-h-[36px]"
      >
        <Plus className="size-4" /> Add trip
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/60 p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border-t sm:border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl max-h-[95vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            <div className="sticky top-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-card)]">
              <div className="text-sm font-semibold">New trip</div>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 hover:bg-[var(--color-accent)]"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="grid gap-3 grid-cols-2 p-5">
              <Field label="Name *" full>
                <Input
                  value={draft.name ?? ""}
                  placeholder="Murray ranch trip"
                  onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
                />
              </Field>
              <Field label="Destination" full>
                <Input
                  value={draft.destination ?? ""}
                  placeholder="Aspen, CO"
                  onChange={(v) => setDraft((d) => ({ ...d, destination: v }))}
                />
              </Field>
              <Field label="Start">
                <Input
                  type="date"
                  value={draft.startDate ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))}
                />
              </Field>
              <Field label="End">
                <Input
                  type="date"
                  value={draft.endDate ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, endDate: v }))}
                />
              </Field>
              <Field label="Status">
                <select
                  value={draft.status ?? "planned"}
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
                  value={draft.costUsd ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, costUsd: v }))}
                />
              </Field>
              <Field label="Travelers (comma separated)" full>
                <Input
                  value={draft.travelers ?? ""}
                  placeholder="Piol, Justin, Fahim"
                  onChange={(v) => setDraft((d) => ({ ...d, travelers: v }))}
                />
              </Field>
              <Field label="Transport">
                <Input
                  value={draft.transport ?? ""}
                  placeholder="Flight"
                  onChange={(v) => setDraft((d) => ({ ...d, transport: v }))}
                />
              </Field>
              <Field label="Accommodation">
                <Input
                  value={draft.accommodation ?? ""}
                  placeholder="Airbnb"
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, accommodation: v }))
                  }
                />
              </Field>
              <Field label="Booking URL" full>
                <Input
                  value={draft.bookingUrl ?? ""}
                  placeholder="https://airbnb.com/…"
                  onChange={(v) => setDraft((d) => ({ ...d, bookingUrl: v }))}
                />
              </Field>
              <Field label="Notes" full>
                <textarea
                  value={draft.notes ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                  rows={3}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none"
                />
              </Field>
            </div>

            <div className="sticky bottom-0 flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-card)]">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-accent)]"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={saving || !draft.name?.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
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
  const isDateLike = type === "date" || type === "datetime-local" || type === "time";
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
