"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Trash2, X } from "lucide-react";

export type PhotoData = {
  id: string;
  url: string;
  caption: string | null;
  width: number | null;
  height: number | null;
};

export function PhotoGallery({
  apiBase,
  photos,
}: {
  apiBase: string; // e.g. "/api/vehicles/<id>" or "/api/pets/<id>"
  photos: PhotoData[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [lightbox, setLightbox] = useState<PhotoData | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`${apiBase}/photos`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const { error: msg } = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(msg ?? `upload failed (${res.status})`);
        }
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deletePhoto(id: string) {
    if (!confirm("Delete this photo?")) return;
    const res = await fetch(`${apiBase}/photos/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      if (lightbox?.id === id) setLightbox(null);
      startTransition(() => router.refresh());
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Photos</h3>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-full bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5 hover:opacity-90 transition disabled:opacity-50"
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          {uploading ? "Uploading…" : "Add photos"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      {error ? (
        <div className="rounded-md bg-rose-500/10 text-rose-500 text-xs px-3 py-2 mb-2">
          {error}
        </div>
      ) : null}

      {photos.length === 0 ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full rounded-xl border border-dashed border-[var(--color-border)] p-10 text-sm text-[var(--color-muted-foreground)] hover:border-[var(--color-foreground)]/30 hover:text-[var(--color-foreground)] transition flex flex-col items-center gap-2"
        >
          <ImagePlus className="size-6" />
          <span>Drop photos or click to upload</span>
        </button>
      ) : (
        <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
          {photos.map((p) => (
            <li
              key={p.id}
              className="group relative aspect-square overflow-hidden rounded-lg bg-[var(--color-accent)]/30"
            >
              <button
                onClick={() => setLightbox(p)}
                className="absolute inset-0"
                aria-label="View photo"
              >
                <Image
                  src={p.url}
                  alt={p.caption ?? "Vehicle photo"}
                  fill
                  sizes="(min-width:1024px) 18vw, (min-width:640px) 24vw, 33vw"
                  className="object-cover transition group-hover:scale-105"
                  unoptimized
                />
              </button>
              <button
                onClick={() => deletePhoto(p.id)}
                className="absolute top-1 right-1 rounded-full bg-black/60 text-white p-1 opacity-50 md:opacity-0 md:group-hover:opacity-100 transition hover:bg-rose-500"
                title="Delete"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(null);
            }}
            className="absolute top-4 right-4 rounded-full bg-white/10 hover:bg-white/20 text-white p-2"
            title="Close"
          >
            <X className="size-5" />
          </button>
          <div className="relative w-full h-full max-w-6xl max-h-[90vh]">
            <Image
              src={lightbox.url}
              alt={lightbox.caption ?? ""}
              fill
              sizes="90vw"
              className="object-contain"
              unoptimized
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
