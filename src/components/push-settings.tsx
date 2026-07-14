"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Send } from "lucide-react";

// Enable/disable web-push on this device, plus a test button. On iPhone the
// app must be installed to the Home Screen (iOS exposes push only to
// installed PWAs) — we surface that instead of failing silently.

type State =
  | "loading"
  | "unsupported"
  | "needs-install"
  | "denied"
  | "off"
  | "on";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushSettings() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const evaluate = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // iOS Safari (not installed): push API is absent entirely.
      const isIos = /iphone|ipad/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as { standalone?: boolean }).standalone === true;
      setState(isIos && !standalone ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    setState(sub ? "on" : "off");
  }, []);

  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  async function enable() {
    setBusy(true);
    setNote(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) {
        setNote("Push isn't configured on the server.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error();
      setState("on");
      setNote("On for this device.");
    } catch {
      setNote("Couldn't enable notifications — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/push/subscribe", { method: "PUT" });
      const { delivered } = (await res.json()) as { delivered: number };
      setNote(
        delivered > 0
          ? `Test sent to ${delivered} device${delivered === 1 ? "" : "s"}.`
          : "No devices reached — re-enable and try again."
      );
    } catch {
      setNote("Test failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Notifications</div>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
            A morning push for todos due today and snoozes coming back, plus
            shared-list activity.
          </p>
        </div>
        {state === "loading" ? (
          <Loader2 className="size-4 animate-spin text-[var(--color-muted-foreground)]" />
        ) : state === "on" ? (
          <button
            onClick={disable}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-accent)] disabled:opacity-50"
          >
            <BellOff className="size-3.5" /> Turn off
          </button>
        ) : state === "off" ? (
          <button
            onClick={enable}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] px-3 py-1.5 text-sm font-medium text-[var(--color-background)] disabled:opacity-50"
          >
            <Bell className="size-3.5" /> Enable
          </button>
        ) : null}
      </div>

      {state === "needs-install" ? (
        <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
          On iPhone, first add EC to your Home Screen (Share → Add to Home
          Screen), then open it from there and enable notifications here.
        </p>
      ) : null}
      {state === "denied" ? (
        <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
          Notifications are blocked for this app in system settings — allow
          them there, then come back.
        </p>
      ) : null}
      {state === "unsupported" ? (
        <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
          This browser doesn&apos;t support web push.
        </p>
      ) : null}

      {state === "on" ? (
        <button
          onClick={sendTest}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs hover:bg-[var(--color-accent)] disabled:opacity-50"
        >
          <Send className="size-3" /> Send test notification
        </button>
      ) : null}
      {note ? (
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">{note}</p>
      ) : null}
    </div>
  );
}
