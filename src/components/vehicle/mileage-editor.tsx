"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil } from "lucide-react";

export function MileageEditor({
  vehicleId,
  currentMileage,
  unit,
}: {
  vehicleId: string;
  currentMileage: number | null;
  unit: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentMileage?.toString() ?? "");
  const [, startTransition] = useTransition();

  async function save() {
    const n = Number(draft.replace(/[^\d]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      setDraft(currentMileage?.toString() ?? "");
      setEditing(false);
      return;
    }
    setEditing(false);
    await fetch(`/api/vehicles/${vehicleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentMileage: n }),
    });
    startTransition(() => router.refresh());
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            else if (e.key === "Escape") {
              setDraft(currentMileage?.toString() ?? "");
              setEditing(false);
            }
          }}
          onBlur={save}
          className="w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-2xl font-bold tabular-nums focus:outline-none focus:border-[var(--color-ring)]"
        />
        <span className="text-sm text-[var(--color-muted-foreground)]">{unit}</span>
        <button
          onClick={save}
          className="rounded-full p-1 text-emerald-500 hover:bg-[var(--color-accent)]"
          title="Save"
        >
          <Check className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group flex items-baseline gap-2 hover:opacity-80 transition"
      title="Edit current mileage"
    >
      <span className="text-3xl font-bold tabular-nums">
        {currentMileage != null ? currentMileage.toLocaleString() : "—"}
      </span>
      <span className="text-sm text-[var(--color-muted-foreground)]">{unit}</span>
      <Pencil className="size-3.5 text-[var(--color-muted-foreground)] opacity-50 md:opacity-0 md:group-hover:opacity-100 transition" />
    </button>
  );
}
