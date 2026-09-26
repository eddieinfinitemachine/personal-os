"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Heart, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { haptic } from "@/lib/haptic";
import { displayHost, type BoardKind } from "@/lib/board-embed";
import { KindGlyph } from "./kind-glyph";
import type { BoardCard } from "./types";

type Rec = {
  id: string;
  kind: BoardKind;
  title: string;
  creator: string | null;
  reason: string;
  url: string | null;
  imageUrl: string | null;
  siteName: string | null;
  price: string | null;
  status: "new" | "saved" | "dismissed";
  createdAt: string;
};

type State = {
  taste: { profile: string | null; status: string; error: string | null; generatedAt: string | null } | null;
  recs: Rec[];
  boardCount: number;
  minItems: number;
};

const POLL_MS = 4000;

export function ForYou({ onSaved, say }: { onSaved: (item: BoardCard) => void; say: (text: string, error?: boolean) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board/recs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as State;
      setState(data);
      if (poll.current) clearTimeout(poll.current);
      if (data.taste?.status === "generating") poll.current = setTimeout(load, POLL_MS);
    } catch {
      poll.current = setTimeout(load, POLL_MS * 2);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [load]);

  async function refresh() {
    setState((s) => (s ? { ...s, taste: { profile: s.taste?.profile ?? null, generatedAt: s.taste?.generatedAt ?? null, error: null, status: "generating" } } : s));
    const res = await fetch("/api/board/recs", { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      say(data?.error ?? "Couldn't start that", true);
    }
    void load();
  }

  async function act(rec: Rec, action: "save" | "dismiss") {
    setBusy((b) => ({ ...b, [rec.id]: true }));
    const res = await fetch(`/api/board/recs/${rec.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as { item?: BoardCard; error?: string } | undefined;
    setBusy((b) => ({ ...b, [rec.id]: false }));
    if (!res?.ok) {
      say(data?.error ?? "Couldn't do that", true);
      return;
    }
    if (action === "save") {
      haptic("success");
      if (data?.item) onSaved(data.item);
      say("Saved to your board");
    }
    setState((s) =>
      s
        ? {
            ...s,
            recs:
              action === "dismiss"
                ? s.recs.filter((r) => r.id !== rec.id)
                : s.recs.map((r) => (r.id === rec.id ? { ...r, status: "saved" } : r)),
          }
        : s,
    );
  }

  if (!state) {
    return (
      <div className="py-24 flex justify-center text-[var(--color-muted-foreground)]">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const generating = state.taste?.status === "generating";
  const fresh = state.recs.filter((r) => r.status === "new");
  const saved = state.recs.filter((r) => r.status === "saved").slice(0, 12);
  const tooFew = state.boardCount < state.minItems;

  if (tooFew && !state.recs.length) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <Sparkles className="mx-auto size-6 text-[var(--color-muted-foreground)]" />
        <p className="mt-3 text-lg font-medium">Picks start after {state.minItems} saves</p>
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
          You have {state.boardCount}. Keep sending things you like, then come back here for recommendations.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 rounded-2xl bg-[var(--color-fill)] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Your taste</p>
            <p className="mt-1.5 text-[15px] leading-relaxed">
              {state.taste?.profile ?? "Get your first picks and a read on your taste from everything you've saved."}
            </p>
            {state.taste?.generatedAt && !generating && (
              <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                Picks from {new Date(state.taste.generatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {" · "}new ones every Saturday
              </p>
            )}
          </div>
          <button
            onClick={refresh}
            disabled={generating || tooFew}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-foreground)] px-3 py-1.5 text-sm font-medium text-[var(--color-background)] disabled:opacity-40 pressable"
          >
            {generating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {generating ? "Finding…" : state.taste?.generatedAt ? "New picks" : "Get picks"}
          </button>
        </div>
        {generating && (
          <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
            Reading your board and searching the web for things you'll like. This takes a minute or two; you can leave
            and come back.
          </p>
        )}
        {state.taste?.status === "error" && state.taste.error && (
          <p className="mt-3 text-sm text-[var(--color-destructive)]">{state.taste.error}</p>
        )}
      </div>

      {generating && !fresh.length ? (
        <div className="columns-2 sm:columns-3 lg:columns-4 gap-2.5">
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="mb-2.5 break-inside-avoid rounded-xl bg-[var(--color-fill)] animate-pulse"
              style={{ height: 160 + ((i * 53) % 120) }}
            />
          ))}
        </div>
      ) : fresh.length ? (
        <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-2.5">
          {fresh.map((r) => (
            <RecCard key={r.id} rec={r} busy={!!busy[r.id]} onSave={() => act(r, "save")} onDismiss={() => act(r, "dismiss")} />
          ))}
        </div>
      ) : (
        !generating && (
          <p className="py-12 text-center text-sm text-[var(--color-muted-foreground)]">
            {state.taste?.generatedAt ? "You've been through every pick. Get new ones anytime." : "No picks yet."}
          </p>
        )
      )}

      {saved.length > 0 && (
        <div className="mt-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Saved from picks</p>
          <div className="flex flex-wrap gap-2">
            {saved.map((r) => (
              <a
                key={r.id}
                href={r.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-fill)] px-3 py-1 text-[13px] hover:bg-[var(--color-accent)]"
              >
                <Check className="size-3 text-[var(--color-success)]" />
                <span className="max-w-56 truncate">{r.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RecCard({ rec, busy, onSave, onDismiss }: { rec: Rec; busy: boolean; onSave: () => void; onDismiss: () => void }) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const host = rec.siteName ?? displayHost(rec.url);
  const showImage = rec.imageUrl && !broken;
  return (
    <div className="group mb-2.5 break-inside-avoid overflow-hidden rounded-xl bg-[var(--color-fill)]">
      {showImage && (
        <a href={rec.url ?? undefined} target="_blank" rel="noreferrer" className="relative block bg-[var(--color-accent)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={rec.imageUrl!}
            alt={rec.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            ref={(el) => {
              if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
            }}
            onLoad={() => setLoaded(true)}
            onError={(e) => {
              // Not every YouTube video has a maxres thumbnail; hq always exists.
              const img = e.currentTarget;
              if (img.src.includes("/maxresdefault.jpg")) img.src = img.src.replace("/maxresdefault.jpg", "/hqdefault.jpg");
              else setBroken(true);
            }}
            className={`block w-full h-auto transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0 min-h-32"}`}
          />
          {(rec.kind === "video" || rec.kind === "music") && (
            <span className="absolute left-2.5 top-2.5 grid size-7 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
              <KindGlyph kind={rec.kind} className="size-3.5" />
            </span>
          )}
          {rec.price && (
            <span className="absolute right-2.5 top-2.5 rounded-full bg-black/45 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
              {rec.price}
            </span>
          )}
        </a>
      )}
      <div className="p-3">
        {!showImage && host && (
          <div className="mb-1 flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
            <KindGlyph kind={rec.kind} className="size-3" />
            <span className="truncate">{host}</span>
            {rec.price && <span className="ml-auto shrink-0">{rec.price}</span>}
          </div>
        )}
        <p className="text-[14px] font-medium leading-snug">{rec.title}</p>
        {rec.creator && <p className="text-[13px] text-[var(--color-muted-foreground)]">{rec.creator}</p>}
        <p className="mt-1.5 text-[13px] leading-snug text-[var(--color-label-secondary)]">{rec.reason}</p>
        <div className="mt-2.5 flex items-center gap-1">
          <button
            onClick={onSave}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-foreground)] px-2.5 py-1 text-[13px] font-medium text-[var(--color-background)] disabled:opacity-50 pressable"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Heart className="size-3.5" />}
            Save
          </button>
          <button
            onClick={onDismiss}
            disabled={busy}
            title="Not for me"
            aria-label="Not for me"
            className="rounded-lg p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] pressable"
          >
            <X className="size-4" />
          </button>
          {rec.url && (
            <a
              href={rec.url}
              target="_blank"
              rel="noreferrer"
              title="Open"
              className="ml-auto rounded-lg p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
