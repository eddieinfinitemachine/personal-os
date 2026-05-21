"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCapture, useCaptureReadyPulse } from "@/lib/capture-store";

// Fixed top-right pill. Hidden when there are no in-flight or pending
// captures. Pulses on parsing → ready transitions so the user notices
// without auto-opening the drawer.
export function CaptureInbox() {
  const { captures, drawerOpen, setDrawerOpen } = useCapture();
  const pulseCount = useCaptureReadyPulse();
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (pulseCount === 0) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 1500);
    return () => clearTimeout(t);
  }, [pulseCount]);

  // Global hotkey: ⌘⇧K toggles the drawer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDrawerOpen(!drawerOpen);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, setDrawerOpen]);

  if (captures.length === 0) return null;

  const parsingCount = captures.filter((c) => c.status === "parsing").length;
  const readyCount = captures.filter((c) => c.status === "ready").length;
  const errorCount = captures.filter((c) => c.status === "error").length;
  const savingCount = captures.filter((c) => c.status === "saving").length;

  return (
    <button
      onClick={() => setDrawerOpen(!drawerOpen)}
      aria-label={`Capture inbox (${captures.length})`}
      title="Capture inbox  ·  ⌘⇧K"
      className={cn(
        "hidden md:inline-flex fixed top-3 right-3 z-40",
        "items-center gap-2 rounded-full border bg-[var(--color-card)] px-3 py-1.5 text-sm font-medium shadow-sm",
        "border-[var(--color-border)] hover:border-[var(--color-foreground)] transition",
        pulsing &&
          "ring-2 ring-[var(--color-tint)]/60 ring-offset-2 ring-offset-[var(--color-background)] animate-[pulse_1.2s_ease-in-out_2]",
      )}
    >
      {parsingCount > 0 || savingCount > 0 ? (
        <Loader2 className="size-4 animate-spin text-[var(--color-muted-foreground)]" />
      ) : errorCount > 0 ? (
        <AlertCircle className="size-4 text-rose-500" />
      ) : (
        <Inbox className="size-4 text-[var(--color-muted-foreground)]" />
      )}
      <span>
        {readyCount > 0 ? (
          <span className="font-semibold">{readyCount}</span>
        ) : null}
        {readyCount > 0 && (parsingCount > 0 || errorCount > 0) ? " · " : ""}
        {parsingCount > 0 ? (
          <span className="text-[var(--color-muted-foreground)]">{parsingCount} parsing</span>
        ) : null}
        {errorCount > 0 ? (
          <span className="text-rose-500">{errorCount} error</span>
        ) : null}
        {readyCount === 0 && parsingCount === 0 && errorCount === 0
          ? captures.length
          : null}
      </span>
    </button>
  );
}
