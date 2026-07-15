"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

export function SaveUrlBar() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    const url = value.trim();
    if (!url) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/reader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        title?: string;
        degraded?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error);
      setValue("");
      setNote(data.degraded ? "Saved (no reader view for that page)." : null);
      router.refresh();
    } catch (e) {
      setNote(e instanceof Error && e.message ? e.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 min-w-64">
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          placeholder="Paste a link to save…"
          className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
        />
        <button
          onClick={save}
          disabled={busy || !value.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50 min-h-[36px]"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Save
        </button>
      </div>
      {note ? (
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{note}</p>
      ) : null}
    </div>
  );
}
