"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";

export function AddVehicleButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({
    mileageUnit: "mi",
  });

  async function submit() {
    const make = draft.make?.trim();
    const model = draft.model?.trim();
    const year = Number(draft.year);
    if (!make || !model || !Number.isFinite(year)) return;
    setSaving(true);
    const res = await fetch("/api/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        make,
        model,
        year,
        bodyStyle: draft.bodyStyle || null,
        exteriorColor: draft.exteriorColor || null,
        transmission: draft.transmission || null,
        vin: draft.vin || null,
        currentMileage: draft.currentMileage
          ? Number(draft.currentMileage)
          : null,
        mileageUnit: draft.mileageUnit || "mi",
        acquiredPriceUsd: draft.acquiredPriceUsd
          ? Number(draft.acquiredPriceUsd)
          : null,
        notes: draft.notes || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const { projectId } = (await res.json()) as { projectId: string };
      setOpen(false);
      setDraft({ mileageUnit: "mi" });
      router.push(`/projects/${projectId}`);
      router.refresh();
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium min-h-[36px]"
      >
        <Plus className="size-4" /> Add vehicle
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
              <div className="text-sm font-semibold">New vehicle</div>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 hover:bg-[var(--color-accent)]"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="grid gap-3 grid-cols-2 p-5">
              <Field label="Year *">
                <Input
                  type="number"
                  value={draft.year ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, year: v }))}
                />
              </Field>
              <Field label="Make *">
                <Input
                  value={draft.make ?? ""}
                  placeholder="Porsche"
                  onChange={(v) => setDraft((d) => ({ ...d, make: v }))}
                />
              </Field>
              <Field label="Model *" full>
                <Input
                  value={draft.model ?? ""}
                  placeholder="911 Carrera"
                  onChange={(v) => setDraft((d) => ({ ...d, model: v }))}
                />
              </Field>
              <Field label="Body style">
                <Input
                  value={draft.bodyStyle ?? ""}
                  placeholder="Coupe"
                  onChange={(v) => setDraft((d) => ({ ...d, bodyStyle: v }))}
                />
              </Field>
              <Field label="Color">
                <Input
                  value={draft.exteriorColor ?? ""}
                  placeholder="Guards Red"
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, exteriorColor: v }))
                  }
                />
              </Field>
              <Field label="Transmission">
                <Input
                  value={draft.transmission ?? ""}
                  placeholder="6-speed manual"
                  onChange={(v) => setDraft((d) => ({ ...d, transmission: v }))}
                />
              </Field>
              <Field label="VIN">
                <Input
                  value={draft.vin ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, vin: v }))}
                />
              </Field>
              <Field label="Mileage">
                <Input
                  type="number"
                  value={draft.currentMileage ?? ""}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, currentMileage: v }))
                  }
                />
              </Field>
              <Field label="Unit">
                <select
                  value={draft.mileageUnit ?? "mi"}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, mileageUnit: e.target.value }))
                  }
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm min-h-[40px]"
                >
                  <option value="mi">mi</option>
                  <option value="km">km</option>
                </select>
              </Field>
              <Field label="Purchase price ($)" full>
                <Input
                  type="number"
                  value={draft.acquiredPriceUsd ?? ""}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, acquiredPriceUsd: v }))
                  }
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
                disabled={
                  saving ||
                  !draft.make?.trim() ||
                  !draft.model?.trim() ||
                  !draft.year
                }
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
  return (
    <input
      type={type ?? "text"}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none min-h-[40px]"
    />
  );
}
