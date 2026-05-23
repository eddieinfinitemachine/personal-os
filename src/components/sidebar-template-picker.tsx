"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { STORAGE_KEY, TEMPLATES, type SidebarTemplate, type TemplateSlug } from "@/lib/templates";

const ENABLED_EVENT = "personalos:enabled-templates-changed";

function readEnabled(): Set<TemplateSlug> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr as TemplateSlug[]);
  } catch {
    return new Set();
  }
}

function writeEnabled(next: Set<TemplateSlug>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  window.dispatchEvent(new CustomEvent(ENABLED_EVENT));
}

// Hook: returns enabled templates (filtered by isPrivate) + an add/remove API.
// Reactive across sidebar/drawer instances within the same tab via a custom
// event, and across tabs via the storage event.
export function useEnabledTemplates(isPrivate: boolean): {
  enabled: SidebarTemplate[];
  available: SidebarTemplate[];
  add: (slug: TemplateSlug) => void;
  remove: (slug: TemplateSlug) => void;
} {
  const [enabledSlugs, setEnabledSlugs] = useState<Set<TemplateSlug>>(() => new Set());

  useEffect(() => {
    setEnabledSlugs(readEnabled());
    const refresh = () => setEnabledSlugs(readEnabled());
    window.addEventListener(ENABLED_EVENT, refresh);
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY) refresh();
    });
    return () => {
      window.removeEventListener(ENABLED_EVENT, refresh);
    };
  }, []);

  const visible = TEMPLATES.filter((t) => (t.privateOnly ? isPrivate : true));
  const enabled = visible.filter((t) => enabledSlugs.has(t.slug));
  const available = visible.filter((t) => !enabledSlugs.has(t.slug));

  const add = (slug: TemplateSlug) => {
    const next = new Set(enabledSlugs);
    next.add(slug);
    writeEnabled(next);
  };
  const remove = (slug: TemplateSlug) => {
    const next = new Set(enabledSlugs);
    next.delete(slug);
    writeEnabled(next);
  };

  return { enabled, available, add, remove };
}

export function AddTemplateButton({
  available,
  onAdd,
  variant = "sidebar",
}: {
  available: SidebarTemplate[];
  onAdd: (slug: TemplateSlug) => void;
  variant?: "sidebar" | "drawer";
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (available.length === 0 && !open) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
          "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]",
          variant === "drawer" && "gap-3 px-3 py-2.5",
        )}
      >
        <span className="text-[var(--color-muted-foreground)]">
          <Plus className="size-4" />
        </span>
        <span className="flex-1 text-left truncate">Add list</span>
      </button>
      {open ? (
        <div
          role="dialog"
          className={cn(
            "mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg",
            variant === "sidebar" ? "p-1" : "p-1.5",
          )}
        >
          {available.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
              All templates added.
            </div>
          ) : (
            <ul className="space-y-0.5 max-h-[60vh] overflow-y-auto">
              {available.map((t) => (
                <li key={t.slug}>
                  <button
                    type="button"
                    onClick={() => {
                      onAdd(t.slug);
                      if (available.length === 1) setOpen(false);
                    }}
                    className="w-full flex items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] text-[var(--color-muted-foreground)] transition"
                  >
                    <t.Icon className="size-4 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--color-foreground)] truncate">{t.label}</div>
                      <div className="text-[11px] leading-snug text-[var(--color-muted-foreground)] mt-0.5">
                        {t.description}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
