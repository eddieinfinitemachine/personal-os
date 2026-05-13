"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export function HeroWeightEditor({
  petId,
  currentWeightLb,
  delta,
}: {
  petId: string;
  currentWeightLb: number | null;
  delta: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentWeightLb?.toFixed(1) ?? "");
  const [, startTransition] = useTransition();

  async function save() {
    const n = Number(draft.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      setDraft(currentWeightLb?.toFixed(1) ?? "");
      setEditing(false);
      return;
    }
    setEditing(false);
    await fetch(`/api/pets/${petId}/weights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightLb: n }),
    });
    startTransition(() => router.refresh());
  }

  if (editing) {
    return (
      <div className="flex items-baseline gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            else if (e.key === "Escape") {
              setDraft(currentWeightLb?.toFixed(1) ?? "");
              setEditing(false);
            }
          }}
          className="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-3xl font-bold tabular-nums focus:outline-none focus:border-[var(--color-ring)]"
        />
        <span className="text-sm text-[var(--color-muted-foreground)]">lb</span>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group flex items-baseline gap-2 hover:opacity-80 transition"
      title="Log a new weight"
    >
      <span className="text-3xl font-bold tabular-nums">
        {currentWeightLb !== null ? currentWeightLb.toFixed(1) : "—"}
      </span>
      <span className="text-sm text-[var(--color-muted-foreground)]">lb</span>
      {delta !== null ? (
        <span
          className={cn(
            "text-xs ml-1 tabular-nums",
            delta > 0
              ? "text-emerald-500"
              : delta < 0
                ? "text-rose-500"
                : "text-[var(--color-muted-foreground)]"
          )}
        >
          {delta > 0 ? "+" : ""}
          {delta.toFixed(1)}
        </span>
      ) : null}
      <Pencil className="size-3 text-[var(--color-muted-foreground)] opacity-30 md:opacity-0 md:group-hover:opacity-50 transition ml-1" />
    </button>
  );
}
