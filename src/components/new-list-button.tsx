"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { LIST_PALETTE, type ListColor } from "@/lib/lists";
import { cn } from "@/lib/utils";

const COLOR_KEYS = Object.keys(LIST_PALETTE) as ListColor[];

export function NewListButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<ListColor>("emerald");
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    // Close the popover immediately. The optimistic tile dispatch below
    // gives the home page a placeholder so the user sees the new list right
    // away; server refresh runs in the background.
    const chosenName = trimmed;
    const chosenColor = color;
    setName("");
    setColor("emerald");
    setOpen(false);
    setSubmitting(true);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: chosenName, color: chosenColor }),
      });
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as
        | { list: { id: string; name: string; color: string; isDefault: boolean } }
        | null;
      if (body?.list) {
        window.dispatchEvent(
          new CustomEvent("personalos:list-created", { detail: { list: body.list } }),
        );
      }
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:border-[var(--color-foreground)]/30 transition"
      >
        <Plus className="size-3.5" />
        New list
      </button>

      {open ? (
        <form
          onSubmit={submit}
          className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-xl p-3 space-y-2.5"
        >
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="List name"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
          />
          <div className="flex flex-wrap gap-1.5">
            {COLOR_KEYS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                className={cn(
                  "size-5 rounded-full transition",
                  LIST_PALETTE[c].dot,
                  color === c
                    ? "ring-2 ring-offset-2 ring-offset-[var(--color-card)] ring-[var(--color-foreground)]"
                    : "opacity-70 hover:opacity-100"
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="flex-1 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" /> Creating…
                </span>
              ) : (
                "Create"
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
