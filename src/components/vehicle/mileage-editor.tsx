"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus } from "lucide-react";

type Mode = "view" | "edit" | "log";

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
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState("");
  const [, startTransition] = useTransition();

  function cancel() {
    setDraft("");
    setMode("view");
  }

  async function commit(next: number) {
    setMode("view");
    setDraft("");
    await fetch(`/api/vehicles/${vehicleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentMileage: next }),
    });
    startTransition(() => router.refresh());
  }

  async function save() {
    const n = Number(draft.replace(/[^\d]/g, ""));
    if (!Number.isFinite(n) || n < 0) return cancel();
    if (mode === "log") {
      // Delta: bump the current odometer by however much was just driven.
      await commit((currentMileage ?? 0) + n);
    } else {
      await commit(n);
    }
  }

  if (mode === "edit" || mode === "log") {
    const placeholder = mode === "log" ? `+${unit} driven` : "Set odometer";
    return (
      <div className="flex items-center gap-2">
        {mode === "log" ? (
          <span className="text-2xl font-bold tabular-nums text-[var(--color-muted-foreground)]">
            +
          </span>
        ) : null}
        <input
          autoFocus
          inputMode="numeric"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            else if (e.key === "Escape") cancel();
          }}
          onBlur={() => {
            if (draft.trim()) void save();
            else cancel();
          }}
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
    <div className="flex items-baseline gap-3">
      <button
        onClick={() => {
          setDraft(currentMileage?.toString() ?? "");
          setMode("edit");
        }}
        className="group flex items-baseline gap-2 hover:opacity-80 transition"
        title="Edit current odometer"
      >
        <span className="text-3xl font-bold tabular-nums">
          {currentMileage != null ? currentMileage.toLocaleString() : "—"}
        </span>
        <span className="text-sm text-[var(--color-muted-foreground)]">{unit}</span>
        <Pencil className="size-3.5 text-[var(--color-muted-foreground)] opacity-50 md:opacity-0 md:group-hover:opacity-100 transition" />
      </button>
      <button
        onClick={() => {
          setDraft("");
          setMode("log");
        }}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition"
        title={`Log distance driven (adds to odometer)`}
      >
        <Plus className="size-3" />
        <span>Log drive</span>
      </button>
    </div>
  );
}
