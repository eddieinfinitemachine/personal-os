"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact bullet list (things to remember, flags) with inline add. Saves the
 * whole list on each change. Claude's suggestions show muted with a + until
 * added.
 */
export function ListEditor({
  title,
  items,
  suggestions = [],
  placeholder,
  tone = "neutral",
  onChange,
}: {
  title: string;
  items: string[];
  suggestions?: string[];
  placeholder: string;
  tone?: "neutral" | "good" | "bad";
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  // Esc closes without saving, even if a blur follows.
  const cancelled = useRef(false);
  const add = () => {
    const t = draft.trim();
    setDraft("");
    if (!t || items.includes(t)) return;
    onChange([...items, t]);
  };
  const dot =
    tone === "good" ? "bg-[var(--color-success)]" : tone === "bad" ? "bg-[var(--color-destructive)]" : "bg-[var(--color-label-tertiary)]";
  const iconBtn =
    "-my-2.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]";
  return (
    <section className="min-w-0">
      <h3 className="mb-1.5 text-caption font-medium uppercase tracking-wide text-[var(--color-label-tertiary)]">{title}</h3>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className="group flex items-start gap-2 text-sm">
            <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", dot)} />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item}</span>
            <button
              onClick={() => onChange(items.filter((i) => i !== item))}
              aria-label={`Remove ${item}`}
              className={cn(iconBtn, "sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100")}
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
        {suggestions.map((s) => (
          <li key={`s:${s}`} className="flex items-start gap-2 text-sm text-[var(--color-muted-foreground)]">
            <span className="mt-[6px] size-1.5 shrink-0 rounded-full border border-current opacity-60" />
            <span className="min-w-0 flex-1 break-words">
              {s}
              <span className="ml-1.5 text-xs text-[var(--color-label-tertiary)]">suggested</span>
            </span>
            <button onClick={() => onChange([...items, s])} aria-label={`Add ${s}`} title="Add" className={iconBtn}>
              <Plus className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="mt-1.5"
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (!cancelled.current) add();
              setAdding(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                cancelled.current = true;
                setDraft("");
                setAdding(false);
              }
            }}
            placeholder={placeholder}
            aria-label={`Add to ${title}`}
            className="w-full min-w-0 rounded-md bg-[var(--color-fill-secondary)] px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            cancelled.current = false;
            setAdding(true);
          }}
          aria-label={`Add to ${title}`}
          className="-ml-1 mt-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm text-[var(--color-label-tertiary)] hover:text-[var(--color-foreground)] sm:min-h-8"
        >
          <Plus className="size-3.5" /> Add
        </button>
      )}
    </section>
  );
}
