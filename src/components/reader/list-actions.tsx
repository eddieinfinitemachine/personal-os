"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";

export function ReaderListActions({
  id,
  archived,
}: {
  id: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
