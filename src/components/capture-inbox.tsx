"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCapture, useCaptureReadyPulse } from "@/lib/capture-store";

// Mounts the global ⌘⇧K hotkey only. The actual pill UI is rendered inline
// in the sidebar via <CaptureInboxPill> to avoid overlapping with per-page
// action buttons (New list, Add person, etc.) in the top-right corner.
export function CaptureInbox() {
  const { drawerOpen, setDrawerOpen } = useCapture();
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
  return null;
}

export function CaptureInboxPill() {
  const { captures, drawerOpen, setDrawerOpen } = useCapture();
  const pulseCount = useCaptureReadyPulse();
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (pulseCount === 0) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 1500);
    return () => clearTimeout(t);
  }, [pulseCount]);

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
        "inline-flex items-center gap-1.5 rounded-full border bg-[var(--color-background)] px-2 py-0.5 text-[11px] font-medium",
        "border-[var(--color-border)] hover:border-[var(--color-foreground)] transition",
        pulsing &&
          "ring-2 ring-[var(--color-tint)]/60 animate-[pulse_1.2s_ease-in-out_2]",
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
