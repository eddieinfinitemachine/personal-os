"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

// Visibility-gated polling for collaborative live updates. Polls
// `/api/sync/poll` while the tab is visible and calls `router.refresh()`
// when the server says the user's accessible todos have changed.
//
// Cheap by design: one tiny aggregate query per tick, paused while the tab
// is hidden, no realtime infra. Stays snappy (~`intervalMs`) while changes
// are flowing, then backs off toward `maxIntervalMs` when nothing has changed
// for a while — so an idle tab (or one whose session has expired and is 401ing)
// settles to a handful of requests/min instead of ~40. Any change, or the tab
// regaining focus, instantly resets to the fast cadence.
export function useSyncPoll(intervalMs: number = 1500, maxIntervalMs: number = 15000) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const lastSeenRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentInterval = intervalMs;

    function backOff() {
      currentInterval = Math.min(currentInterval * 2, maxIntervalMs);
    }
    function resetCadence() {
      currentInterval = intervalMs;
    }

    async function poll() {
      if (cancelled || inFlightRef.current) return schedule();
      if (document.visibilityState !== "visible") return schedule();
      inFlightRef.current = true;
      try {
        const res = await fetch("/api/sync/poll", { cache: "no-store" });
        if (!res.ok) {
          // Transient (5xx) or expired session (401) — keep polling but ease
          // off so we don't spin at full rate against a failing endpoint.
          backOff();
          return;
        }
        const body = (await res.json()) as { latestAt: string | null };
        const next = body.latestAt;
        if (lastSeenRef.current === null) {
          lastSeenRef.current = next;
          backOff();
        } else if (next !== lastSeenRef.current) {
          lastSeenRef.current = next;
          resetCadence(); // something changed — stay responsive
          startTransition(() => router.refresh());
        } else {
          backOff(); // quiet tick
        }
      } catch {
        backOff(); // network errored; keep polling, eased off
      } finally {
        inFlightRef.current = false;
        schedule();
      }
    }

    function schedule() {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, currentInterval);
    }

    function onVisibility() {
      // Wake immediately and at full cadence when the tab regains focus.
      if (document.visibilityState === "visible") {
        resetCadence();
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
  }, [intervalMs, maxIntervalMs]);
}
