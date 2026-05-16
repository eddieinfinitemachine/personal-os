"use client";

import { useEffect } from "react";

// Register the Serwist-built /sw.js so the PWA caches assets + last-good HTML
// for offline. Production-only; in dev the SW build is disabled.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
