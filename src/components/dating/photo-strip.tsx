"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image-compress";
import type { DatingPhotoDTO } from "@/lib/dating-photos";

// Vercel rejects function bodies over 4.5 MB; stay under like the board does.
const MAX_UPLOAD_BYTES = 4.4 * 1024 * 1024;

const ghost =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50";

type Pending = { key: string; preview: string };

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function PhotoStrip({
  personId,
  firstName,
  photos,
  setPhotos,
  setError,
}: {
  personId: string;
  firstName: string;
  photos: DatingPhotoDTO[];
  setPhotos: React.Dispatch<React.SetStateAction<DatingPhotoDTO[]>>;
  setError: (e: string | null) => void;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
      if (!images.length) return;
      const queued = images.map((f) => ({ file: f, key: `${Date.now()}-${Math.random()}`, preview: URL.createObjectURL(f) }));
      setPending((p) => [...queued.map(({ key, preview }) => ({ key, preview })), ...p]);
      const done = (key: string, preview: string) => {
        URL.revokeObjectURL(preview);
        setPending((p) => p.filter((x) => x.key !== key));
      };
      // One at a time: each request carries a whole photo, and order stays newest-first.
      for (const { file, key, preview } of queued) {
        let body: File = file;
        try {
          // GIFs keep their animation; everything else shrinks client-side.
          if (file.type !== "image/gif") body = await compressImage(file);
        } catch {
          // Undecodable here (e.g. HEIC on Chrome); let the server try.
        }
        if (body.size > MAX_UPLOAD_BYTES) {
          done(key, preview);
          setError(`${file.name || "That photo"} is over 4 MB. Try a smaller version.`);
          continue;
        }
        const form = new FormData();
        form.append("file", body);
        const res = await fetch(`/api/dating/${personId}/photos`, { method: "POST", body: form }).catch(() => null);
        const data = await res?.json().catch(() => ({}));
        done(key, preview);
        if (!res?.ok) {
          setError(data?.error ?? "Could not add that photo");
          continue;
        }
        setError(null);
        setPhotos((list) => [data.photo as DatingPhotoDTO, ...list]);
      }
    },
    [personId, setPhotos, setError],
  );

  // Paste an image anywhere on the Overview (not while typing).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || open !== null) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void upload(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, upload]);

  // Drop image files anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void upload(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [upload]);

  const remove = async (photo: DatingPhotoDTO) => {
    const index = photos.findIndex((p) => p.id === photo.id);
    setPhotos((list) => list.filter((p) => p.id !== photo.id));
    setOpen((o) => (o === null ? null : photos.length - 1 <= 0 ? null : Math.min(o, photos.length - 2)));
    const res = await fetch(`/api/dating/photos/${photo.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setError("Could not delete that photo");
      setPhotos((list) => (list.some((p) => p.id === photo.id) ? list : [...list.slice(0, index), photo, ...list.slice(index)]));
      return;
    }
    setError(null);
  };

  const saveCaption = async (photo: DatingPhotoDTO, caption: string) => {
    const next = caption.trim() || null;
    if (next === photo.caption) return;
    setPhotos((list) => list.map((p) => (p.id === photo.id ? { ...p, caption: next } : p)));
    const res = await fetch(`/api/dating/photos/${photo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption: next }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) return setError(data?.error ?? "Could not save the caption");
    setError(null);
    setPhotos((list) => list.map((p) => (p.id === photo.id ? data.photo : p)));
  };

  const count = photos.length + pending.length;

  return (
    <section aria-label="Photos">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Photos{photos.length > 0 && " "}
          {photos.length > 0 && <span className="font-normal text-[var(--color-label-tertiary)]">{photos.length}</span>}
        </h3>
        <button type="button" onClick={() => fileRef.current?.click()} className={cn(ghost, "-mr-2.5")}>
          <ImagePlus className="size-4" /> Add
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {count === 0 ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-card-border)] px-4 py-5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-fill-secondary)] hover:text-[var(--color-foreground)] transition"
        >
          <ImagePlus className="size-4" /> Add photos of {firstName}. You can also paste or drop them here.
        </button>
      ) : (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {pending.map((p) => (
            <li key={p.key} className="relative aspect-square overflow-hidden rounded-lg bg-[var(--color-fill)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="size-full object-cover opacity-50" />
              <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-[var(--color-foreground)]" aria-label="Uploading" />
            </li>
          ))}
          {photos.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setOpen(i)}
                aria-label={p.caption ? `Open photo: ${p.caption}` : `Open photo ${i + 1} of ${firstName}`}
                className="pressable block aspect-square w-full overflow-hidden rounded-lg bg-[var(--color-fill)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.caption ?? ""} loading="lazy" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {open !== null && photos[open] && (
        <PhotoLightbox
          key={photos[open].id}
          photo={photos[open]}
          index={open}
          total={photos.length}
          firstName={firstName}
          onClose={() => setOpen(null)}
          onPrev={open > 0 ? () => setOpen(open - 1) : undefined}
          onNext={open < photos.length - 1 ? () => setOpen(open + 1) : undefined}
          onDelete={() => remove(photos[open])}
          onCaption={(c) => saveCaption(photos[open], c)}
        />
      )}

      {dragging && (
        <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-[var(--color-background)]/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-[var(--color-foreground)]/40 px-10 py-8 text-lg font-medium">
            Drop to add photos of {firstName}
          </div>
        </div>
      )}
    </section>
  );
}

function PhotoLightbox({
  photo,
  index,
  total,
  firstName,
  onClose,
  onPrev,
  onNext,
  onDelete,
  onCaption,
}: {
  photo: DatingPhotoDTO;
  index: number;
  total: number;
  firstName: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onDelete: () => void;
  onCaption: (caption: string) => void;
}) {
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [confirming, setConfirming] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (confirming) return setConfirming(false);
        // Closing unmounts the caption field before it can blur, so save here.
        if (isTyping(e.target)) onCaption(caption);
        onClose();
      } else if (isTyping(e.target)) return;
      else if (e.key === "ArrowLeft") onPrev?.();
      else if (e.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [caption, confirming, onCaption, onClose, onPrev, onNext]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${total}`}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm text-white/60 tabular-nums">
          {index + 1} / {total}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          alt={photo.caption ?? `${firstName}`}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
        {onPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrev();
            }}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 -translate-y-1/2 grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        {onNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 -translate-y-1/2 grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"
          >
            <ChevronRight className="size-5" />
          </button>
        )}
      </div>
      <div
        className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => onCaption(caption)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          maxLength={300}
          placeholder="Add a caption"
          aria-label="Caption"
          className="min-w-0 flex-1 basis-48 rounded-md bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-white/40"
        />
        {confirming ? (
          <div className="flex items-center gap-1" role="group" aria-label="Confirm delete">
            <span className="text-sm text-white/70">Delete this photo?</span>
            <button
              type="button"
              autoFocus
              onClick={onDelete}
              className="rounded-md bg-[var(--color-destructive)] px-3 py-2 text-sm font-medium text-white"
            >
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-3 py-2 text-sm text-white/80 hover:bg-white/10">
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white"
          >
            <Trash2 className="size-4" /> Delete
          </button>
        )}
      </div>
    </div>
  );
}
