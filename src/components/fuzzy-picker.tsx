"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function FuzzyPicker({
  title,
  options,
  onPick,
  onClose,
}: {
  title: string;
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 20);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options
      .filter((o) => o.label.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aStarts = a.label.toLowerCase().startsWith(needle) ? 0 : 1;
        const bStarts = b.label.toLowerCase().startsWith(needle) ? 0 : 1;
        return aStarts - bStarts || a.label.localeCompare(b.label);
      });
  }, [q, options]);

  return (
    <div
      className="absolute inset-0 z-10 grid place-items-start justify-center pt-[18vh] bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-overlay="scale"
        data-state="open"
        className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated,var(--color-card))] shadow-2xl overflow-hidden"
      >
        <div className="px-3 pt-3 pb-1 text-xs font-medium text-[var(--color-muted-foreground)]">
          {title}
        </div>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (filtered[hi]) onPick(filtered[hi].id);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          placeholder="Type to filter…"
          className="w-full bg-transparent px-3 py-2 text-sm focus:outline-none border-b border-[var(--color-border)]"
        />
        <ul className="max-h-60 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
              No matches
            </li>
          ) : (
            filtered.map((o, i) => (
              <li key={o.id}>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(o.id);
                  }}
                  onMouseEnter={() => setHi(i)}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-sm",
                    i === hi && "bg-[var(--color-accent)]/60"
                  )}
                >
                  {o.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
