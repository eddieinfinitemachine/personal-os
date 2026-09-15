"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, BookUp, Loader2, Trash2 } from "lucide-react";

export function ReaderListActions({
  id,
  archived,
  kindleConfigured = false,
}: {
  id: string;
  archived: boolean;
  kindleConfigured?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [kindleLoading, setKindleLoading] = useState(false);
  const [kindleError, setKindleError] = useState<string | null>(null);

  async function sendToKindle() {
    if (kindleLoading) return;

    setKindleLoading(true);
    setKindleError(null);

    try {
      const response = await fetch(`/api/reader/${id}/kindle`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!response.ok || body?.ok === false) {
        throw new Error(body?.error || "Failed to send to Kindle.");
      }

      router.refresh();
    } catch (error) {
      setKindleError(
        error instanceof Error ? error.message : "Failed to send to Kindle.",
      );
    } finally {
      setKindleLoading(false);
    }
  }

  async function toggleArchive() {
    setBusy(true);
    await fetch(`/api/reader/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !archived }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 2500);
      return;
    }
    setBusy(true);
    await fetch(`/api/reader/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-0.5 opacity-60 md:opacity-0 md:group-hover:opacity-100 transition">
      {kindleConfigured ? (
        <button
          type="button"
          onClick={() => void sendToKindle()}
          disabled={busy || kindleLoading}
          className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:cursor-wait"
          title={
            kindleError
              ? kindleError
              : kindleLoading
                ? "Sending to Kindle…"
                : "Send to Kindle"
          }
        >
          {kindleLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <BookUp className="size-4" />
          )}
        </button>
      ) : null}
      <button
        onClick={toggleArchive}
        disabled={busy}
        className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
        title={archived ? "Unarchive" : "Archive"}
      >
        {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
      </button>
      <button
        onClick={remove}
        disabled={busy}
        className={
          confirming
            ? "rounded p-1.5 bg-rose-500 text-white"
            : "rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-rose-500/10 hover:text-rose-500"
        }
        title={confirming ? "Tap again to delete" : "Delete"}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
