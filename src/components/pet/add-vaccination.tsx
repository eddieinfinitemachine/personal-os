"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

export function AddVaccination({ petId }: { petId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [administeredAt, setAdministeredAt] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [boosterDueAt, setBoosterDueAt] = useState("");
  const [vet, setVet] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    const res = await fetch(`/api/pets/${petId}/vaccinations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        administeredAt,
        boosterDueAt: boosterDueAt || null,
        vet: vet.trim() || null,
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      setName("");
      setBoosterDueAt("");
      setVet("");
      setOpen(false);
      startTransition(() => router.refresh());
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] inline-flex items-center gap-1 transition"
      >
        <Plus className="size-3" /> Add vaccination
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 grid gap-2 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1 text-xs sm:col-span-2">
        <span className="text-[var(--color-muted-foreground)]">Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. DHPP, Rabies, Bordetella"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--color-muted-foreground)]">Administered</span>
        <input
          type="date"
          value={administeredAt}
          onChange={(e) => setAdministeredAt(e.target.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--color-muted-foreground)]">Next booster (optional)</span>
        <input
          type="date"
          value={boosterDueAt}
          onChange={(e) => setBoosterDueAt(e.target.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs sm:col-span-2">
        <span className="text-[var(--color-muted-foreground)]">Vet (optional)</span>
        <input
          value={vet}
          onChange={(e) => setVet(e.target.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
        />
      </label>
      <div className="sm:col-span-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={!name.trim() || submitting}
          className="rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-[var(--color-muted-foreground)]"
        >
          <X className="size-4" />
        </button>
      </div>
    </form>
  );
}
