"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bed,
  Coffee,
  Compass,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Plane,
  X,
} from "lucide-react";
import { haptic } from "@/lib/haptic";
import type { ScanProposal } from "@/lib/email-scan";
import type { TripItemRow } from "./trip-itinerary";

// "Pull from email": scans Gmail for booking confirmations for this trip, then
// lets the user review and commit them as itinerary items. Mirrors the
// meeting-import scan→review two-step; nothing is written until "Add" is clicked.

type Phase = "idle" | "scanning" | "review";

type Draft = { include: boolean; p: ScanProposal };

const KIND_ICONS: Record<string, typeof Plane> = {
  flight: Plane,
  lodging: Bed,
  activity: Compass,
  transport: MapPin,
  meal: Coffee,
  note: Pencil,
};

function fmtWhen(startAt: string | null): string | null {
  if (!startAt) return null;
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TripEmailImport({
  tripId,
  autoScan,
  onAdded,
}: {
  tripId: string;
  autoScan: boolean;
  onAdded: (items: TripItemRow[]) => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const scanAbort = useRef<AbortController | null>(null);

  const scanning = phase === "scanning";
  const open = phase !== "idle";

  // Elapsed-seconds ticker for the scanning interstitial.
  useEffect(() => {
    if (!scanning) {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [scanning]);

  // Auto-open the scan when arriving from the create flow (?scan=1), then strip
  // the query param so a refresh doesn't re-trigger it.
  useEffect(() => {
    if (autoScan) {
      void scan();
      window.history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const includedCount = useMemo(() => drafts.filter((d) => d.include).length, [drafts]);

  async function scan() {
    const controller = new AbortController();
    scanAbort.current = controller;
    setPhase("scanning");
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/email-scan`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Scan failed (HTTP ${res.status}).`);
        setPhase("review");
        setDrafts([]);
        setScanned(0);
        return;
      }
      const data = (await res.json()) as { proposals: ScanProposal[]; scanned: number };
      setDrafts(data.proposals.map((p) => ({ include: !p.duplicate, p })));
      setScanned(data.scanned);
      setPhase("review");
      haptic("success");
    } catch (e) {
      // A user-initiated cancel just returns to idle, no error surfaced.
      if (e instanceof DOMException && e.name === "AbortError") {
        setPhase("idle");
        return;
      }
      setError(e instanceof Error ? e.message : "Network error.");
      setPhase("review");
    } finally {
      scanAbort.current = null;
    }
  }

  async function commit() {
    const included = drafts.filter((d) => d.include).map((d) => d.p);
    if (included.length === 0) return;
    setCommitting(true);
    setError(null);
    try {
      const items = included.map((p) => ({
        kind: p.kind,
        title: p.title,
        // Naive wall-clock interpreted in the viewer's timezone — matches the
        // ItemEditor manual-entry convention.
        startAt: p.startAt ? new Date(p.startAt).toISOString() : null,
        endAt: p.endAt ? new Date(p.endAt).toISOString() : null,
        location: p.location,
        fromLocation: p.fromLocation,
        toLocation: p.toLocation,
        confirmation: p.confirmation,
        url: p.url,
        costUsd: p.costUsd,
        notes: p.notes,
      }));
      const res = await fetch(`/api/trips/${tripId}/items/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Add failed (HTTP ${res.status}).`);
        return;
      }
      const data = (await res.json()) as { items: TripItemRow[] };
      haptic("success");
      onAdded(data.items);
      router.refresh();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setCommitting(false);
    }
  }

  function close() {
    setPhase("idle");
    setDrafts([]);
    setScanned(0);
    setError(null);
    setElapsed(0);
  }

  return (
    <>
      <button
        onClick={() => void scan()}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-accent)]"
      >
        <Mail className="size-3.5" />
        Pull from email
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/60 p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !committing) close();
          }}
        >
          <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border-t sm:border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl max-h-[95vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {scanning ? (
              <div className="grid place-items-center gap-3 px-6 py-16 text-center">
                <Loader2 className="size-6 animate-spin text-[var(--color-muted-foreground)]" />
                <div className="text-sm font-semibold">Searching your email…</div>
                <p className="max-w-sm text-sm text-[var(--color-muted-foreground)]">
                  Searching Gmail for bookings for this trip… usually 20–40
                  seconds.
                </p>
                <div className="text-xs tabular-nums text-[var(--color-muted-foreground)]">
                  {elapsed}s
                </div>
                <button
                  onClick={() => scanAbort.current?.abort()}
                  className="mt-1 rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-accent)] min-h-[40px]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div className="sticky top-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-card)]">
                  <div className="text-sm font-semibold">
                    Found in your email
                    {drafts.length > 0 ? (
                      <span className="ml-2 font-normal text-[var(--color-muted-foreground)]">
                        {includedCount} of {drafts.length} selected
                      </span>
                    ) : null}
                  </div>
                  <button
                    onClick={close}
                    disabled={committing}
                    className="rounded p-1 hover:bg-[var(--color-accent)] disabled:opacity-50"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="p-5">
                  {drafts.length === 0 ? (
                    <div className="grid place-items-center gap-3 py-8 text-center">
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        {error ?? "No booking emails found for this trip."}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void scan()}
                          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-accent)] min-h-[40px]"
                        >
                          Scan again
                        </button>
                        <button
                          onClick={close}
                          className="rounded-md px-4 py-2 text-sm hover:bg-[var(--color-accent)] min-h-[40px]"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {scanned > 0 ? (
                        <p className="-mt-1 mb-1 text-xs text-[var(--color-muted-foreground)]">
                          Scanned {scanned} email{scanned === 1 ? "" : "s"}. Review
                          and uncheck anything that doesn&apos;t belong.
                        </p>
                      ) : null}
                      {drafts.map((d, i) => {
                        const Icon = KIND_ICONS[d.p.kind] ?? Pencil;
                        const when = fmtWhen(d.p.startAt);
                        const route =
                          d.p.fromLocation || d.p.toLocation
                            ? `${d.p.fromLocation ?? "?"} → ${d.p.toLocation ?? "?"}`
                            : d.p.location;
                        return (
                          <div
                            key={i}
                            className={
                              "rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 " +
                              (d.include ? "" : "opacity-50")
                            }
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={d.include}
                                onChange={(e) =>
                                  setDrafts((prev) =>
                                    prev.map((x, idx) =>
                                      idx === i
                                        ? { ...x, include: e.target.checked }
                                        : x
                                    )
                                  )
                                }
                                className="mt-1 size-4 accent-[var(--color-foreground)]"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <Icon className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
                                  <span className="font-medium truncate">
                                    {d.p.title}
                                  </span>
                                  {d.p.duplicate ? (
                                    <span className="shrink-0 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                                      possible duplicate
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--color-muted-foreground)]">
                                  {when ? <span>{when}</span> : null}
                                  {route ? <span className="truncate">{route}</span> : null}
                                  {d.p.confirmation ? (
                                    <span className="font-mono">{d.p.confirmation}</span>
                                  ) : null}
                                  {d.p.costUsd != null ? (
                                    <span className="tabular-nums">
                                      ${d.p.costUsd.toLocaleString()}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-[var(--color-muted-foreground)]">
                                  {d.p.sourceSubject}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {error && drafts.length > 0 ? (
                    <p className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>
                  ) : null}
                </div>

                {drafts.length > 0 ? (
                  <div className="sticky bottom-0 flex items-center justify-between gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-card)]">
                    <button
                      onClick={close}
                      disabled={committing}
                      className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-accent)] disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={commit}
                      disabled={includedCount === 0 || committing}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-4 py-2 text-sm font-medium disabled:opacity-50 min-h-[40px]"
                    >
                      {committing ? <Loader2 className="size-4 animate-spin" /> : null}
                      {`Add ${includedCount} item${includedCount === 1 ? "" : "s"}`}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
