"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Editable bullet list (things to remember, flags). Saves the whole list on each change. */
export function ListEditor({
  title,
  items,
  placeholder,
  tone = "neutral",
  onChange,
}: {
  title: string;
  items: string[];
  placeholder: string;
  tone?: "neutral" | "good" | "bad";
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t || items.includes(t)) return setDraft("");
    onChange([...items, t]);
    setDraft("");
  };
  const dot =
    tone === "good" ? "bg-[var(--color-success)]" : tone === "bad" ? "bg-[var(--color-destructive)]" : "bg-[var(--color-label-tertiary)]";
  return (
    <section className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <ul className="space-y-1 mb-2">
        {items.map((item) => (
          <li key={item} className="group flex items-start gap-2 text-sm">
            <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", dot)} />
            <span className="flex-1 whitespace-pre-wrap">{item}</span>
            <button
              onClick={() => onChange(items.filter((i) => i !== item))}
              aria-label={`Remove ${item}`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 rounded-md bg-[var(--color-fill-secondary)] px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
        />
        <button
          type="submit"
          aria-label="Add"
          className="rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
        >
          <Plus className="size-4" />
        </button>
      </form>
    </section>
  );
}
