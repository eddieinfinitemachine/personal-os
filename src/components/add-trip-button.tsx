"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Sparkles, X } from "lucide-react";
import type { TripProposal } from "@/lib/smart-capture";

const TRIP_PARSE_ERROR =
  "Couldn't read that as a trip — fill the fields manually.";
const TRIP_STATUSES = new Set([
  "planned",
  "booked",
  "active",
  "past",
  "cancelled",
]);

export function AddTripButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nlText, setNlText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({
    status: "planned",
  });

  function closeModal() {
    setOpen(false);
    setNlText("");
    setParsing(false);
    setParseError(null);
  }

  async function fillFromText() {
    const text = nlText.trim();
    if (!text || parsing) return;

    setParsing(true);
    setParseError(null);

    try {
      const fd = new FormData();
      fd.set("text", text);
      fd.set("forceType", "trip");

      const res = await fetch("/api/capture/smart/parse", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error("trip parse failed");

      const data = (await res.json()) as {
        proposal?: Partial<TripProposal>;
      };
      const proposal = data.proposal;
      if (proposal?.type !== "trip") {
        setParseError(TRIP_PARSE_ERROR);
        return;
      }

      setDraft((current) => {
        const next = { ...current };
        if (proposal.name != null) next.name = proposal.name;
        if (proposal.destination != null) {
          next.destination = proposal.destination;
        }
        if (proposal.startDate != null) next.startDate = proposal.startDate;
        if (proposal.endDate != null) next.endDate = proposal.endDate;
        if (
          proposal.status != null &&
          TRIP_STATUSES.has(proposal.status)
        ) {
          next.status = proposal.status;
        }
        if (
          Array.isArray(proposal.travelers) &&
          proposal.travelers.length > 0
        ) {
          next.travelers = proposal.travelers.join(", ");
        }
        if (proposal.transport != null) next.transport = proposal.transport;
        if (proposal.accommodation != null) {
          next.accommodation = proposal.accommodation;
        }
        if (typeof proposal.costUsd === "number") {
          next.costUsd = String(proposal.costUsd);
        }
        if (proposal.bookingUrl != null) {
          next.bookingUrl = proposal.bookingUrl;
        }
        if (proposal.notes != null) next.notes = proposal.notes;
        return next;
      });
    } catch {
      setParseError(TRIP_PARSE_ERROR);
    } finally {
      setParsing(false);
    }
  }

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
      const data = (await res.json()) as { trip: { id: string } };
      closeModal();
      setDraft({ status: "planned" });
      router.push(`/trips/${data.trip.id}?scan=1`);
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
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border-t sm:border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl max-h-[95vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            <div className="sticky top-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-card)]">
              <div className="text-sm font-semibold">New trip</div>
              <button
                onClick={closeModal}
                className="rounded p-1 hover:bg-[var(--color-accent)]"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="border-b border-[var(--color-border)] p-5">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--color-muted-foreground)]">
                <Sparkles className="size-3.5" />
                Describe it
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    value={nlText}
                    placeholder="Tokyo Jan 5–12 with Maya, Park Hyatt booked"
                    onChange={setNlText}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void fillFromText();
                      }
                    }}
                  />
                </div>
                <button
                  onClick={fillFromText}
                  disabled={parsing || !nlText.trim()}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md bg-[var(--color-foreground)] px-3 py-2 text-sm font-medium text-[var(--color-background)] disabled:opacity-50"
                >
                  {parsing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Fill
                </button>
              </div>
              {parseError ? (
                <div className="mt-1.5 text-xs text-[var(--color-destructive)]">
                  {parseError}
                </div>
              ) : null}
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
                onClick={closeModal}
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
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const isDateLike = type === "date" || type === "datetime-local" || type === "time";
  return (
    <input
      type={type ?? "text"}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
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
