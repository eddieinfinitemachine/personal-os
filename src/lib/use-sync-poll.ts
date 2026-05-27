"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

// Visibility-gated polling for collaborative live updates. Polls
// `/api/sync/poll` while the tab is visible and calls `router.refresh()`
// when the server says the user's accessible todos have changed.
//
// Cheap by design: one tiny aggregate query per tick, paused while the tab
// is hidden, no realtime infra. Latency ~1.5s perceived.
export function useSyncPoll(intervalMs: number = 1500) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const lastSeenRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (cancelled || inFlightRef.current) return schedule();
      if (document.visibilityState !== "visible") return schedule();
      inFlightRef.current = true;
      try {
        const res = await fetch("/api/sync/poll", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { latestAt: string | null };
        const next = body.latestAt;
        if (lastSeenRef.current === null) {
          lastSeenRef.current = next;
        } else if (next !== lastSeenRef.current) {
          lastSeenRef.current = next;
          startTransition(() => router.refresh());
        }
      } catch {
        /* network errored; keep polling */
      } finally {
        inFlightRef.current = false;
        schedule();
      }
    }

    function schedule() {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, intervalMs);
    }

    function onVisibility() {
      // Wake immediately when the tab regains focus so resumes feel snappy.
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        timer = setTimeout(poll, 0);
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    // Kick off the first poll asynchronously so the hook is non-blocking.
    timer = setTimeout(poll, intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
}
