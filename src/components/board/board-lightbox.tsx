"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Trash2, X } from "lucide-react";
import { displayHost, embedUrl } from "@/lib/board-embed";
import type { BoardCard } from "./types";

export function BoardLightbox({
  item,
  onClose,
  onPrev,
  onNext,
  onDelete,
  onUpdate,
}: {
  item: BoardCard;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onDelete: () => void;
  onUpdate: (patch: { note?: string | null }) => void;
}) {
  const [note, setNote] = useState(item.note ?? "");
  const [playing, setPlaying] = useState(false);
  const embed = embedUrl(item.url);
  const host = item.siteName ?? displayHost(item.url);

  useEffect(() => {
    setNote(item.note ?? "");
    setPlaying(false);
  }, [item.id, item.note]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName);
      if (e.key === "Escape") onClose();
      else if (typing) return;
      else if (e.key === "ArrowLeft") onPrev?.();
      else if (e.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, onPrev, onNext]);

  const saveNote = () => {
    const next = note.trim() || null;
    if (next !== (item.note ?? null)) onUpdate({ note: next });
  };

  const tall = embed && item.kind === "music";

  return (
    <div className="fixed inset-0 z-50 flex flex-col md:flex-row bg-black/92 text-white" onClick={onClose}>
      <div className="relative flex-1 min-h-0 flex items-center justify-center p-4 md:p-10">
        {playing && embed ? (
          <iframe
            src={embed}
            title={item.title ?? "Player"}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
            allowFullScreen
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-4xl rounded-xl bg-black ${tall ? "h-[380px] max-w-xl" : "aspect-video"}`}
          />
        ) : item.imageUrl ? (
          <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imageUrl}
              alt={item.title ?? ""}
              className="max-h-[70vh] md:max-h-[88vh] max-w-full rounded-lg object-contain"
            />
            {embed && (
              <button
                onClick={() => setPlaying(true)}
                className="absolute inset-0 m-auto grid size-16 place-items-center rounded-full bg-white/90 text-black shadow-modal pressable"
                aria-label="Play"
              >
                <svg viewBox="0 0 24 24" className="ml-1 size-7" fill="currentColor" aria-hidden>
                  <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
                </svg>
              </button>
            )}
          </div>
        ) : (
          <div
            className="max-w-xl w-full rounded-2xl bg-white/[0.06] p-8 text-lg leading-relaxed whitespace-pre-wrap break-words"
            onClick={(e) => e.stopPropagation()}
          >
            {item.kind === "note" ? item.note : item.title ?? item.url}
          </div>
        )}

        {onPrev && (
          <NavButton side="left" onClick={onPrev}>
            <ChevronLeft className="size-5" />
          </NavButton>
        )}
        {onNext && (
          <NavButton side="right" onClick={onNext}>
            <ChevronRight className="size-5" />
          </NavButton>
        )}
      </div>

      <aside
        className="w-full md:w-80 shrink-0 max-h-[40vh] md:max-h-none overflow-y-auto border-t md:border-t-0 md:border-l border-white/10 bg-neutral-950 p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {item.title && item.kind !== "note" && <h2 className="text-base font-semibold leading-snug">{item.title}</h2>}
            {host && <p className="mt-0.5 text-sm text-white/55 truncate">{host}</p>}
            {item.price && <p className="mt-1 text-sm font-medium">{item.price}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        {item.kind !== "note" && (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            placeholder="Why you liked it…"
            rows={3}
            className="w-full resize-none rounded-lg bg-white/[0.06] p-3 text-sm outline-none placeholder:text-white/35 focus:bg-white/[0.09]"
          />
        )}

        <div className="flex flex-wrap gap-2">
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black hover:opacity-90 pressable"
            >
              <ExternalLink className="size-3.5" />
              Open
            </a>
          )}
          {embed && !playing && (
            <button onClick={() => setPlaying(true)} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/15 pressable">
              Play here
            </button>
          )}
          <button
            onClick={() => {
              if (confirm("Remove from your board?")) onDelete();
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-white/60 hover:bg-white/10 hover:text-[var(--color-destructive)] pressable"
          >
            <Trash2 className="size-3.5" />
            Remove
          </button>
        </div>

        <p className="mt-auto text-xs text-white/35">
          Saved {new Date(item.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          {item.via !== "app" ? ` · via ${item.via}` : ""}
        </p>
      </aside>
    </div>
  );
}

function NavButton({ side, onClick, children }: { side: "left" | "right"; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`absolute top-1/2 -translate-y-1/2 ${side === "left" ? "left-2 md:left-4" : "right-2 md:right-4"} hidden sm:grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 pressable`}
    >
      {children}
    </button>
  );
}
