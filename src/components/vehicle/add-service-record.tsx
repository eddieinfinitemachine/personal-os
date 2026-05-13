"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ServiceItemOption = { id: string; name: string };

export function AddServiceRecord({
  vehicleId,
  items,
}: {
  vehicleId: string;
  items: ServiceItemOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [performedAt, setPerformedAt] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [mileage, setMileage] = useState("");
  const [shop, setShop] = useState("");
  const [workSummary, setWorkSummary] = useState("");
  const [costUsd, setCostUsd] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  const [quickText, setQuickText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  async function parseQuickText() {
    const text = quickText.trim();
    if (!text) return;
    setParseError(null);
    setParsing(true);
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/parse-service`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(error ?? `parse failed (${res.status})`);
      }
      const { parsed } = (await res.json()) as {
        parsed: {
          performedAt?: string;
          mileage?: number | null;
          shop?: string | null;
          workSummary?: string;
          costUsd?: number | null;
          serviceItemIds?: string[];
        };
      };
      if (parsed.performedAt) setPerformedAt(parsed.performedAt);
      if (parsed.mileage != null) setMileage(String(parsed.mileage));
      if (parsed.shop) setShop(parsed.shop);
      if (parsed.workSummary) setWorkSummary(parsed.workSummary);
      if (parsed.costUsd != null) setCostUsd(String(parsed.costUsd));
      if (parsed.serviceItemIds && parsed.serviceItemIds.length > 0) {
        setSelected(new Set(parsed.serviceItemIds));
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "parse failed");
    } finally {
      setParsing(false);
    }
  }

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setPerformedAt(new Date().toISOString().slice(0, 10));
    setMileage("");
    setShop("");
    setWorkSummary("");
    setCostUsd("");
    setSelected(new Set());
    setQuickText("");
    setParseError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!workSummary.trim()) return;
    setSubmitting(true);
    const res = await fetch(`/api/vehicles/${vehicleId}/service-records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        performedAt,
        mileage: mileage ? Number(mileage.replace(/[^\d]/g, "")) : null,
        shop: shop.trim() || null,
        workSummary: workSummary.trim(),
        costUsd: costUsd ? Number(costUsd.replace(/[^\d.]/g, "")) : null,
        serviceItemIds: Array.from(selected),
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      reset();
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
        <Plus className="size-3.5" /> Log service
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Log a service</h3>
        <button
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
          title="Close"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 mb-3">
        <label className="flex items-center gap-1.5 text-xs font-medium text-violet-400 mb-1.5">
          <Sparkles className="size-3.5" /> Quick log — describe the service in plain English
        </label>
        <textarea
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              parseQuickText();
            }
          }}
          rows={2}
          placeholder='e.g. "Oil change at J. Scuderia today, ~60500 km, $450"'
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:outline-none focus:border-violet-500 resize-y"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-[var(--color-muted-foreground)]">
            ⌘↵ to parse · fills the form below for review
          </span>
          <button
            type="button"
            onClick={parseQuickText}
            disabled={!quickText.trim() || parsing}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-500/15 hover:bg-violet-500/25 text-violet-400 px-2.5 py-1 text-xs font-medium disabled:opacity-50 transition"
          >
            {parsing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Sparkles className="size-3" />
            )}
            {parsing ? "Parsing…" : "Parse with Claude"}
          </button>
        </div>
        {parseError ? (
          <div className="mt-2 text-xs text-rose-500">{parseError}</div>
        ) : null}
      </div>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-muted-foreground)]">Date</span>
          <input
            type="date"
            value={performedAt}
            onChange={(e) => setPerformedAt(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-ring)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-muted-foreground)]">Mileage</span>
          <input
            value={mileage}
            onChange={(e) => setMileage(e.target.value)}
            placeholder="e.g. 60000"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-ring)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">
          <span className="text-[var(--color-muted-foreground)]">Shop</span>
          <input
            value={shop}
            onChange={(e) => setShop(e.target.value)}
            placeholder="e.g. J. Scuderia"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-ring)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">
          <span className="text-[var(--color-muted-foreground)]">Work performed</span>
          <textarea
            value={workSummary}
            onChange={(e) => setWorkSummary(e.target.value)}
            rows={3}
            placeholder="What was done…"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-ring)] resize-y"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-muted-foreground)]">Cost (USD)</span>
          <input
            value={costUsd}
            onChange={(e) => setCostUsd(e.target.value)}
            placeholder="0.00"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-ring)]"
          />
        </label>

        {items.length > 0 ? (
          <fieldset className="sm:col-span-2 mt-1">
            <legend className="text-xs text-[var(--color-muted-foreground)] mb-1.5">
              Mark as completed for these items
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {items.map((it) => {
                const on = selected.has(it.id);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => toggleItem(it.id)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs border transition",
                      on
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-500"
                        : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    )}
                  >
                    {it.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <div className="sm:col-span-2 flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={!workSummary.trim() || submitting}
            className="rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              reset();
            }}
            className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
