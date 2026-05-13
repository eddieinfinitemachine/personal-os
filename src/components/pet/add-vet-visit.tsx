"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

export function AddVetVisit({ petId }: { petId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [performedAt, setPerformedAt] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [reason, setReason] = useState("");
  const [vet, setVet] = useState("");
  const [details, setDetails] = useState("");
  const [costUsd, setCostUsd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    const res = await fetch(`/api/pets/${petId}/vet-visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        performedAt,
        reason: reason.trim(),
        vet: vet.trim() || null,
        details: details.trim() || null,
        costUsd: costUsd ? Number(costUsd.replace(/[^\d.]/g, "")) : null,
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      setReason("");
      setVet("");
      setDetails("");
      setCostUsd("");
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
        <Plus className="size-3" /> Log vet visit
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 grid gap-2 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--color-muted-foreground)]">Date</span>
        <input
          type="date"
          value={performedAt}
          onChange={(e) => setPerformedAt(e.target.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--color-muted-foreground)]">Reason</span>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Annual checkup"
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
      <label className="flex flex-col gap-1 text-xs sm:col-span-2">
        <span className="text-[var(--color-muted-foreground)]">Details</span>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={2}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm resize-y"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--color-muted-foreground)]">Cost (USD)</span>
        <input
          value={costUsd}
          onChange={(e) => setCostUsd(e.target.value)}
          placeholder="0.00"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
        />
      </label>
      <div className="sm:col-span-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={!reason.trim() || submitting}
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
