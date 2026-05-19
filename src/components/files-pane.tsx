"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  Link2,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

export type AttachmentData = {
  id: string;
  kind: string;
  title: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  createdAt: Date | string;
};

type DropboxEntry = {
  tag: "file" | "folder";
  name: string;
  pathLower: string;
  pathDisplay: string;
  serverModified?: string;
  size?: number;
};

const IMAGE_EXTS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "tiff",
]);

function isImageName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? IMAGE_EXTS.has(ext) : false;
}

export function FilesPane({
  projectId,
  attachments,
}: {
  projectId: string;
  attachments: AttachmentData[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploadError(null);
    setUploading(true);

    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setUploadProgress(`Uploading ${i + 1} of ${list.length}: ${f.name}`);
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", f);
      try {
        const res = await fetch("/api/attachments/upload", { method: "POST", body: form });
        if (!res.ok) {
          failed++;
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setUploadError(body.error ?? `Upload failed: ${f.name}`);
        }
      } catch {
        failed++;
        setUploadError(`Network error uploading ${f.name}`);
      }
    }

    setUploading(false);
    setUploadProgress(null);
    if (failed < list.length) {
      startTransition(() => router.refresh());
    }
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) await uploadFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const res = await fetch("/api/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        title: title.trim() || trimmed,
        url: trimmed,
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      setTitle("");
      setUrl("");
      setAdding(false);
      startTransition(() => router.refresh());
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this attachment?")) return;
    const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    if (res.ok) startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      {/* Drag-drop / upload zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) await uploadFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-5 transition-colors ${
          dragOver
            ? "border-[var(--color-foreground)] bg-[var(--color-card)]"
            : "border-[var(--color-border)]"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Upload className="size-5 text-[var(--color-muted-foreground)]" />
            <div>
              <div className="text-sm font-medium">Upload files</div>
              <div className="text-xs text-[var(--color-muted-foreground)]">
                Drag &amp; drop, or click to browse. Up to 50 MB each.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 self-start rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-card)] disabled:opacity-50 sm:self-auto"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {uploading ? "Uploading…" : "Choose files"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={onPickFiles}
            className="hidden"
          />
        </div>
        {uploadProgress ? (
          <div className="mt-3 text-xs text-[var(--color-muted-foreground)]">{uploadProgress}</div>
        ) : null}
        {uploadError ? (
          <div className="mt-3 text-xs text-rose-500">{uploadError}</div>
        ) : null}
      </div>

      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-4">
        {adding ? (
          <form onSubmit={addLink} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… or Dropbox folder URL"
              className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className="sm:w-56 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!url.trim() || submitting || pending}
              className="rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setUrl("");
                setTitle("");
              }}
              className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition"
          >
            <Plus className="size-4" />
            <span>Paste a link or Dropbox folder</span>
          </button>
        )}
      </div>

      {attachments.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] p-12 text-center text-sm text-[var(--color-muted-foreground)]">
          <Paperclip className="size-8 mx-auto mb-3" />
          No attachments yet.
        </div>
      ) : (
        <ul className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] divide-y divide-[var(--color-border)]">
          {attachments.map((a) =>
            a.kind === "dropbox" ? (
              <DropboxFolderRow key={a.id} attachment={a} onDelete={() => remove(a.id)} />
            ) : (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <Link2 className="size-4 text-[var(--color-muted-foreground)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{a.title}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)] truncate">
                    {a.url}
                  </div>
                </div>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                  title="Open"
                >
                  <ExternalLink className="size-4" />
                </a>
                <button
                  onClick={() => remove(a.id)}
                  className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-rose-500"
                  title="Delete"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

function DropboxFolderRow({
  attachment,
  onDelete,
}: {
  attachment: AttachmentData;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<DropboxEntry[] | null>(null);

  useEffect(() => {
    if (!open || entries !== null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/dropbox/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: attachment.url }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()) || "list failed");
        return res.json();
      })
      .then((data: { entries: DropboxEntry[] }) => {
        if (!cancelled) setEntries(data.entries);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entries, attachment.url]);

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
          title={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <Folder className="size-4 text-blue-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{attachment.title}</div>
          <div className="text-xs text-[var(--color-muted-foreground)] truncate">
            {attachment.url}
          </div>
        </div>
        <a
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
          title="Open in Dropbox"
        >
          <ExternalLink className="size-4" />
        </a>
        <button
          onClick={onDelete}
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-rose-500"
          title="Delete"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      {open ? (
        <div className="px-4 pb-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)] py-2">
              <Loader2 className="size-3 animate-spin" /> Loading folder…
            </div>
          ) : error ? (
            <div className="text-xs text-rose-500 py-2">{error}</div>
          ) : entries && entries.length > 0 ? (
            <DropboxGrid entries={entries} />
          ) : (
            <div className="text-xs text-[var(--color-muted-foreground)] py-2">
              Empty folder
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

function DropboxGrid({ entries }: { entries: DropboxEntry[] }) {
  const folders = entries.filter((e) => e.tag === "folder");
  const files = entries.filter((e) => e.tag === "file");
  const images = files.filter((f) => isImageName(f.name));
  const others = files.filter((f) => !isImageName(f.name));

  return (
    <div className="space-y-3">
      {folders.length > 0 ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {folders.map((f) => (
            <li
              key={f.pathLower}
              className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs"
            >
              <Folder className="size-3.5 text-blue-500 shrink-0" />
              <span className="truncate">{f.name}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {images.length > 0 ? (
        <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {images.map((img) => (
            <li
              key={img.pathLower}
              className="aspect-square overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-accent)]/30 relative"
              title={img.name}
            >
              <Image
                src={`/api/dropbox/thumbnail?path=${encodeURIComponent(img.pathDisplay)}`}
                alt={img.name}
                fill
                sizes="(min-width:1024px) 16vw, (min-width:640px) 24vw, 33vw"
                className="object-cover"
                unoptimized
              />
            </li>
          ))}
        </ul>
      ) : null}

      {others.length > 0 ? (
        <ul className="space-y-1">
          {others.map((f) => (
            <li
              key={f.pathLower}
              className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]"
            >
              <Paperclip className="size-3 shrink-0" />
              <span className="truncate">{f.name}</span>
              {f.size ? (
                <span className="tabular-nums shrink-0">{prettyBytes(f.size)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
