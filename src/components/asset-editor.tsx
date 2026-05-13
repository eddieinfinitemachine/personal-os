"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import type { AssetRow } from "./asset-grid";

export type EditorField = {
  key: keyof AssetRow;
  label: string;
  type?: "text" | "textarea" | "number" | "url" | "date";
  placeholder?: string;
  full?: boolean; // span both columns
};

export function AssetEditor({
  open,
  asset,
  kind,
  fields,
  onClose,
}: {
  open: boolean;
  asset: AssetRow | null; // null = creating new
  kind: string;
  fields: EditorField[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Hydrate the draft when opened.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    if (asset) {
      for (const f of fields) {
        const v = asset[f.key];
        if (v == null) continue;
        if (f.type === "date") {
          const d = v instanceof Date ? v : new Date(v as string);
          if (Number.isFinite(d.getTime()))
            next[f.key as string] = d.toISOString().slice(0, 10);
        } else {
          next[f.key as string] = String(v);
        }
      }
      next.title = asset.title;
    }
    setDraft(next);
    setTimeout(() => titleRef.current?.focus(), 30);
  }, [open, asset, fields]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    const title = draft.title?.trim();
    if (!title) return;
    setSaving(true);
    const payload: Record<string, unknown> = { kind, title };
    for (const f of fields) {
      const raw = draft[f.key as string];
      if (f.type === "number") {
        if (raw === undefined || raw === "") payload[f.key as string] = null;
        else
          payload[f.key as string] = Number(raw.replace(/[^\d.-]/g, ""));
      } else if (f.type === "date") {
        payload[f.key as string] = raw ? raw : null;
      } else {
        payload[f.key as string] = raw === undefined ? null : raw;
      }
    }
    const res = asset
      ? await fetch(`/api/assets/${asset.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (res.ok) {
      onClose();
      router.refresh();
    }
  }

  async function remove() {
    if (!asset) return;
    if (!confirm(`Delete "${asset.title}"?`)) return;
    setDeleting(true);
    const res = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      onClose();
      router.refresh();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="text-sm font-semibold">
            {asset ? `Edit · ${asset.title}` : "New entry"}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-[var(--color-accent)]"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 p-5">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">
              Title
            </label>
            <input
              ref={titleRef}
              value={draft.title ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
              }}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
            />
          </div>

          {fields.map((f) => (
            <div
              key={f.key as string}
              className={f.full ? "sm:col-span-2" : undefined}
            >
              <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">
                {f.label}
              </label>
              {f.type === "textarea" ? (
                <textarea
                  value={draft[f.key as string] ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      [f.key as string]: e.target.value,
                    }))
                  }
                  placeholder={f.placeholder}
                  rows={4}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none resize-y"
                />
              ) : (
                <input
                  type={
                    f.type === "number"
                      ? "number"
                      : f.type === "date"
                        ? "date"
                        : f.type === "url"
                          ? "url"
                          : "text"
                  }
                  step={f.type === "number" ? "any" : undefined}
                  value={draft[f.key as string] ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      [f.key as string]: e.target.value,
                    }))
                  }
                  placeholder={f.placeholder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
                  }}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
                />
              )}
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-card)]">
          {asset ? (
            <button
              onClick={remove}
              disabled={deleting || saving}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !draft.title?.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              {asset ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
