"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ChevronRight, Phone } from "lucide-react";
import type { CallSheetResponse } from "@/lib/call-sheet/types";

type Progress = { completed: number; total: number } | null;

// Load once for Home's two responsive layouts; refresh when returning from a check-in.
export function useCallSheetProgress(): Progress {
  const [progress, setProgress] = useState<Progress>(null);
  useEffect(() => {
    let active = true;
    let pending: AbortController | null = null;
    async function refresh() {
      if (document.visibilityState === "hidden" || pending) return;
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch("/api/call-sheet", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not load check-ins");
        const data: CallSheetResponse = await response.json();
        if (!Array.isArray(data.entries)) throw new Error("Invalid check-ins");
        if (active) setProgress({ completed: data.entries.filter(entry => entry.status !== "pending").length, total: data.entries.length });
      } catch {
        if (active) setProgress(null);
      } finally {
        clearTimeout(timeout);
        pending = null;
      }
    }
    void refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      pending?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return progress;
}

export function CallSheetShortcut({ progress }: { progress: Progress }) {
  const complete = progress && progress.total > 0 && progress.completed === progress.total;
  const Icon = complete ? Check : Phone;
  return (
    <Link href="/call-sheet" draggable={false} className="mb-2 flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2">
      <Icon aria-hidden="true" className="size-4 shrink-0 text-[var(--color-muted-foreground)]" />
      <span className="min-w-0 flex-1">
        <span className="block">Call Sheet</span>
        <span className="block text-xs text-[var(--color-muted-foreground)]">{progress?.total ? `${progress.completed} of ${progress.total} checked in today` : "Your daily check-ins"}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[var(--color-muted-foreground)]" />
    </Link>
  );
}
