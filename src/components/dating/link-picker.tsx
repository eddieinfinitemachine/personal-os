"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { foldName, LIKELY_MATCH, rankByName } from "@/lib/dating-match";
import { Sheet } from "./sheet";

export type PickablePerson = { id: string; name: string; stage: string };

const STAGE_LABEL: Record<string, string> = {
  talking: "Pursuing",
  dating: "Dating",
  exclusive: "Exclusive",
  paused: "Paused",
  ended: "Ended",
};

/**
 * "Add to…" on a Granola suggestion: pick who the name really is. Everyone
 * is listed best match first, the top one highlighted when it's a likely
 * match; typing filters.
 * ↑/↓ move, Enter picks, Esc closes.
 */
export function LinkPicker({
  name,
  people,
  onPick,
  onClose,
  description = "Files only this meeting note on her timeline.",
}: {
  name: string;
  description?: string;
  people: PickablePerson[];
  onPick: (person: PickablePerson) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  // null = untouched: highlight the best match, or nothing when no one is a
  // likely match (so Enter can't file her onto a stranger).
  const [picked, setHi] = useState<number | null>(null);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);

  const options = useMemo(() => {
    const needle = foldName(q);
    if (!needle) return rankByName(name, people);
    return rankByName(q, people).filter((p) => p.score >= LIKELY_MATCH || foldName(p.name).includes(needle));
  }, [q, name, people]);
  const hi = picked ?? ((options[0]?.score ?? 0) >= LIKELY_MATCH ? 0 : -1);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <Sheet title={`Add “${name}” to…`} onClose={onClose}>
      <p className="px-4 text-xs text-[var(--color-muted-foreground)]">
        {description}
      </p>
      <div className="px-4 pt-2">
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={options[hi] ? optionId(hi) : undefined}
          aria-label="Search your people"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(e.target.value.trim() ? 0 : null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi(Math.min(hi + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi(Math.max(hi - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (options[hi]) onPick(options[hi]);
            }
          }}
          placeholder="Search your people…"
          autoComplete="off"
          className="w-full rounded-md bg-[var(--color-fill-secondary)] px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
        />
      </div>
      <ul ref={list} id={listId} role="listbox" aria-label="People" className="max-h-72 overflow-y-auto px-2 py-2">
        {options.length === 0 ? (
          <li className="px-2 py-2 text-sm text-[var(--color-muted-foreground)]">No one matches.</li>
        ) : (
          options.map((p, i) => (
            <li
              key={p.id}
              id={optionId(i)}
              data-index={i}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(p)}
              onMouseEnter={() => setHi(i)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm",
                i === hi && "bg-[var(--color-accent)]",
              )}
            >
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
                {STAGE_LABEL[p.stage] ?? p.stage}
              </span>
            </li>
          ))
        )}
      </ul>
    </Sheet>
  );
}
