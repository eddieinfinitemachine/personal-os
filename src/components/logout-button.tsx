"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function onClick() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // Defense-in-depth: tell the service worker to purge any cached
      // per-user data before the next sign-in. Runtime rules don't cache
      // /api/* or HTML, but a stale SW from an old deploy might still hold
      // user-scoped responses.
      try {
        navigator.serviceWorker?.controller?.postMessage({ type: "purge-caches" });
      } catch {
        /* ignore; logout still succeeded */
      }
      router.replace("/");
      router.refresh();
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={submitting}
      className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-4 text-sm font-medium hover:bg-[var(--color-card)] disabled:opacity-50"
    >
      {submitting ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      Sign out
    </button>
  );
}
