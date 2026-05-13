"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

export function AddWeight({ petId }: { petId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [measuredAt, setMeasuredAt] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [weight, setWeight] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(weight.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return;
    setSubmitting(true);
    const res = await fetch(`/api/pets/${petId}/weights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ measuredAt, weightLb: n }),
    });
    setSubmitting(false);
    if (res.ok) {
      setWeight("");
      setMeasuredAt(new Date().toISOString().slice(0, 10));
      setOpen(false);
      startTransition(() => router.refresh());
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5 hover:opacity-90 transition"
      >
        <Plus className="size-3.5" /> Log weight
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="date"
        value={measuredAt}
        onChange={(e) => setMeasuredAt(e.target.value)}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs"
      />
      <input
        autoFocus
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        placeholder="lb"
        className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={!weight || submitting}
        className="rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-2.5 py-1 text-xs font-medium disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setWeight("");
        }}
        className="rounded p-1 text-[var(--color-muted-foreground)]"
      >
        <X className="size-3.5" />
      </button>
    </form>
  );
}
