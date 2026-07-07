"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import type { AssetRow } from "./asset-grid";
import { haptic } from "@/lib/haptic";

export type EditorField = {
  key: keyof AssetRow | (string & {});
  label: string;
  type?: "text" | "textarea" | "number" | "url" | "date";
  placeholder?: string;
  suggestions?: string[]; // closed vocab → rendered as one-tap chips
  detail?: boolean; // stored in detailsJson[key] instead of a column
  full?: boolean; // span both columns
};

export function detailStr(a: AssetRow, key: string): string | null {
  const d = a.detailsJson;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const v = (d as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v : null;
}

const MAPS_URL_RE =
  /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.[a-z.]{2,6})\//i;

type PlaceHit = {
  title: string;
  subtitle: string;
  location: string | null;
  category: string | null;
  url: string;
};

export function AssetEditor({
  open,
  asset,
  kind,
  fields,
  autoEnrich,
  onClose,
}: {
  open: boolean;
  asset: AssetRow | null; // null = creating new
  kind: string;
  fields: EditorField[];
  autoEnrich?: "place" | "media"; // link in `url` fills empty fields
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enriched, setEnriched] = useState(false);
  const enrichedUrlRef = useRef<string | null>(null);
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [hitsOpen, setHitsOpen] = useState(false);
  const [hitIdx, setHitIdx] = useState(0);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const suppressSearchRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Hydrate the draft when opened.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    if (asset) {
      for (const f of fields) {
        const v = f.detail
          ? detailStr(asset, f.key as string)
          : asset[f.key as keyof AssetRow];
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
    enrichedUrlRef.current = null;
    setEnriched(false);
    // Don't pop the search dropdown for a title we hydrated ourselves.
    suppressSearchRef.current = next.title ?? null;
    setHits([]);
    setHitsOpen(false);
    setTimeout(() => titleRef.current?.focus(), 30);
  }, [open, asset, fields]);

  // Search places by name as the title is typed (Places page only).
  const draftTitle = draft.title;
  useEffect(() => {
    if (autoEnrich !== "place" || !open) return;
    const q = draftTitle?.trim() ?? "";
    if (q.length < 3 || suppressSearchRef.current === q) {
      setHits([]);
      setHitsOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      setSearchingPlaces(true);
      try {
        const res = await fetch(
          `/api/assets/search-place?q=${encodeURIComponent(q)}`
        );
        if (!res.ok) return;
        const { results } = (await res.json()) as { results: PlaceHit[] };
        setHits(results);
        setHitIdx(0);
        setHitsOpen(results.length > 0);
      } catch {
        // Search is best-effort; typing a title by hand always works.
      } finally {
        setSearchingPlaces(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [draftTitle, open, autoEnrich]);

  function pickHit(h: PlaceHit) {
    suppressSearchRef.current = h.title;
    enrichedUrlRef.current = h.url; // the picked hit already carries its data
    setDraft((d) => ({
      ...d,
      title: h.title,
      location: h.location ?? d.location ?? "",
      category: h.category ?? d.category ?? "",
      url: h.url,
    }));
    setHits([]);
    setHitsOpen(false);
    haptic("tick");
  }

  // Auto-enrich from a pasted Google Maps link: fill fields the user hasn't
  // typed into; never overwrite their input.
  const draftUrl = draft.url;
  useEffect(() => {
    if (!autoEnrich || !open) return;
    const u = draftUrl?.trim();
    const matches =
      autoEnrich === "place" ? MAPS_URL_RE.test(u ?? "") : /^https?:\/\/\S+$/i.test(u ?? "");
    if (!u || !matches || enrichedUrlRef.current === u) return;
    const t = setTimeout(async () => {
      enrichedUrlRef.current = u;
      setEnriching(true);
      setEnriched(false);
      try {
        const res = await fetch(
          autoEnrich === "place"
            ? "/api/assets/enrich-place"
            : "/api/assets/enrich-media",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: u }),
          }
        );
        if (!res.ok) return;
        const got = (await res.json()) as Record<string, string | null>;
        setDraft((d) => {
          const next = { ...d };
          for (const key of ["title", "location", "category", "subtitle", "imageUrl"]) {
            if (!next[key]?.trim() && got[key]) next[key] = got[key]!;
          }
          return next;
        });
        setEnriched(true);
        haptic("success");
      } catch {
        // Enrichment is best-effort; the form still works by hand.
      } finally {
        setEnriching(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [draftUrl, open, autoEnrich]);

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
    if (!title) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = { kind, title };
    const details: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = draft[f.key as string];
      if (f.detail) {
        const trimmed = raw?.trim();
        details[f.key as string] = trimmed ? trimmed : null;
        continue;
      }
      if (f.type === "number") {
        if (raw === undefined || raw === "") payload[f.key as string] = null;
        else
          payload[f.key as string] = Number(raw.replace(/[^\d.-]/g, ""));
      } else if (f.type === "date") {
        payload[f.key as string] = raw ? raw : null;
      } else {
        const trimmed = raw?.trim();
        payload[f.key as string] = trimmed ? trimmed : null;
      }
    }
    if (Object.keys(details).length) payload.details = details;
    try {
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
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Save failed (HTTP ${res.status}).`);
        setSaving(false);
        return;
      }
      haptic("success");
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!asset) return;
    // Inline two-tap confirm instead of window.confirm() — iOS PWAs often
    // suppress the native confirm dialog, which made the Delete button
    // appear broken.
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      haptic("tick");
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Delete failed (HTTP ${res.status}).`);
        setDeleting(false);
        setConfirmingDelete(false);
        return;
      }
      haptic("success");
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 pb-[calc(1rem+56px+env(safe-area-inset-bottom))] md:pb-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl max-h-[85vh] overflow-y-auto">
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
          <div className="sm:col-span-2 relative">
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
                if (hitsOpen && hits.length) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHitIdx((i) => Math.min(i + 1, hits.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHitIdx((i) => Math.max(i - 1, 0));
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    pickHit(hits[hitIdx]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setHitsOpen(false);
                    return;
                  }
                }
                if (e.key === "Enter") save();
              }}
              onBlur={() => setTimeout(() => setHitsOpen(false), 150)}
              placeholder={
                autoEnrich === "place" ? "search a place name…" : undefined
              }
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
            />
            {autoEnrich === "place" && searchingPlaces ? (
              <Loader2 className="absolute right-2.5 top-[30px] size-3.5 animate-spin text-[var(--color-muted-foreground)]" />
            ) : null}
            {hitsOpen && hits.length ? (
              <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
                {hits.map((h, i) => (
                  <li key={`${h.title}-${i}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickHit(h);
                      }}
                      onMouseEnter={() => setHitIdx(i)}
                      className={
                        "block w-full px-2.5 py-1.5 text-left " +
                        (i === hitIdx ? "bg-[var(--color-accent)]/60" : "")
                      }
                    >
                      <div className="text-sm">{h.title}</div>
                      {h.subtitle ? (
                        <div className="text-xs text-[var(--color-muted-foreground)] truncate">
                          {h.subtitle}
                        </div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
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
                    if (e.key === "Enter") save();
                  }}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
                />
              )}
              {autoEnrich && f.key === "url" && (enriching || enriched) ? (
                <div className="mt-1 flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
                  {enriching ? (
                    <>
                      <Loader2 className="size-3 animate-spin" /> Looking up
                      place…
                    </>
                  ) : (
                    autoEnrich === "place" ? "✓ Filled from Google Maps" : "✓ Filled from link"
                  )}
                </div>
              ) : null}
              {f.suggestions?.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {f.suggestions.map((s) => {
                    const active = draft[f.key as string] === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          haptic("tick");
                          setDraft((d) => ({
                            ...d,
                            [f.key as string]: active ? "" : s,
                          }));
                        }}
                        className={
                          "rounded-md px-2 py-1 text-xs transition " +
                          (active
                            ? "bg-[var(--color-foreground)] text-[var(--color-background)]"
                            : "bg-[var(--color-accent)]/60 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")
                        }
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {error ? (
          <div className="border-t border-rose-500/30 bg-rose-500/10 px-5 py-2 text-sm text-rose-500">
            {error}
          </div>
        ) : null}

        <div className="sticky bottom-0 flex items-center justify-between gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-card)]">
          {asset ? (
            <button
              onClick={remove}
              disabled={deleting || saving}
              className={
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 " +
                (confirmingDelete
                  ? "bg-rose-500 text-white hover:bg-rose-600"
                  : "text-rose-500 hover:bg-rose-500/10")
              }
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {confirmingDelete ? "Tap to confirm" : "Delete"}
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
