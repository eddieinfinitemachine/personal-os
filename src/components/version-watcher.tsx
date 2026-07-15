"use client";

import { useEffect, useRef } from "react";

// Long-lived windows (the installed PWA especially) keep executing the JS
// they loaded days ago — deploys silently pass them by. Poll the build id
// and hard-reload the moment it changes: immediately if the window is
// hidden, otherwise on the next visibility change or idle gap.

const POLL_MS = 5 * 60 * 1000;

export function VersionWatcher() {
  const versionRef = useRef<string | null>(null);
  const staleRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const { version } = (await res.json()) as { version: string };
        if (!versionRef.current) {
          versionRef.current = version;
          return;
        }
        if (version !== versionRef.current) {
          staleRef.current = true;
          // Hidden window: reload invisibly right now.
          if (document.visibilityState === "hidden") location.reload();
        }
      } catch {
        // Offline or flaky network — try again next tick.
      }
    }

    const interval = setInterval(check, POLL_MS);
    void check();

    // Stale + user just came back or went away → reload at a calm moment.
    function onVisibility() {
      if (staleRef.current) location.reload();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
