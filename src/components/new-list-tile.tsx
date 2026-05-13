"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { LIST_PALETTE, type ListColor } from "@/lib/lists";
import { cn } from "@/lib/utils";

const COLOR_KEYS = Object.keys(LIST_PALETTE) as ListColor[];

export function NewListTile() {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<ListColor>("emerald");
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, color }),
    });
    setSubmitting(false);
    if (res.ok) {
      setName("");
      setColor("emerald");
      setAdding(false);
      startTransition(() => router.refresh());
    }
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="rounded-2xl border border-dashed border-[var(--color-border)] bg-transparent flex flex-col items-center justify-center min-h-[420px] text-[var(--color-muted-foreground)] hover:border-[var(--color-foreground)]/30 hover:text-[var(--color-foreground)] hover:bg-[var(--color-card)]/40 transition cursor-pointer"
      >
        <Plus className="size-5 mb-1" />
        <span className="text-sm">New list</span>
      </button>
    );
  }

  return (
    <div className="rounded-2xl bg-[var(--color-card)]/60 backdrop-blur flex flex-col min-h-[420px]">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="font-semibold tracking-tight">New list</h2>
      </div>
      <form onSubmit={createList} className="flex-1 flex flex-col gap-4 p-4">
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1.5">
            Name
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setAdding(false);
                setName("");
              }
            }}
            placeholder="e.g. Reading, Errands…"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1.5">
            Color
          </label>
          <div className="flex flex-wrap gap-2">
            {COLOR_KEYS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                className={cn(
                  "size-6 rounded-full transition",
                  LIST_PALETTE[c].dot,
                  color === c
                    ? "ring-2 ring-offset-2 ring-offset-[var(--color-card)] ring-[var(--color-foreground)]"
                    : "opacity-70 hover:opacity-100"
                )}
              />
            ))}
          </div>
        </div>
        <div className="mt-auto flex items-center gap-2">
          <button
            type="submit"
            disabled={!name.trim() || submitting || pending}
            className="rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50 transition"
          >
            {submitting || pending ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" /> Creating…
              </span>
            ) : (
              "Create list"
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setName("");
            }}
            className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
