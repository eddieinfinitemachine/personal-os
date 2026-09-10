"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, FileText, Image as ImageIcon, Loader2, Paperclip, Plus, Trash2 } from "lucide-react";
import { haptic } from "@/lib/haptic";

type Owner = { assetId: string } | { todoId: string };
export type AttachmentData = {
  id: string; kind: string; title: string; url: string;
  mimeType: string | null; size: number | null; createdAt: string | Date;
};

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function uploadAttachment(owner: Owner, file: File): Promise<AttachmentData> {
  const form = new FormData();
  for (const [key, value] of Object.entries(owner)) form.append(key, value);
  form.append("file", file);
  const res = await fetch("/api/attachments/upload", { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || "Upload failed.");
  }
  const body = await res.json() as { attachment: AttachmentData };
  return body.attachment;
}

export function AttachmentDropZone({ onFiles, disabled, children }: {
  onFiles: (files: File[]) => void; disabled?: boolean; children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!disabled) onFiles(Array.from(e.dataTransfer.files)); }}
      className={`rounded-md border border-dashed p-3 ${dragOver ? "border-[var(--color-tint)] bg-[var(--color-accent)]/60" : "border-[var(--color-border)]"}`}
    >
      <input ref={input} type="file" multiple accept="image/*,application/pdf,.heic" className="hidden" disabled={disabled}
        onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <button type="button" disabled={disabled} onClick={() => input.current?.click()}
        className="mb-2 inline-flex items-center gap-1 text-[12px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-50">
        <Plus className="size-3.5" /> Add file
      </button>
      {children}
    </div>
  );
}

type Props = { owner: Owner; initial?: AttachmentData[]; onCountChange?: (n: number) => void };
export function AttachmentList(props: Props) {
  const key = "assetId" in props.owner ? `assetId=${encodeURIComponent(props.owner.assetId)}` : `todoId=${encodeURIComponent(props.owner.todoId)}`;
  return <AttachmentListContent key={key} {...props} query={key} />;
}

function AttachmentListContent({ owner, initial, onCountChange, query }: Props & { query: string }) {
  const [items, setItems] = useState(initial ?? []);
  const [loading, setLoading] = useState(initial === undefined);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState(0);
  const busy = useRef(false);
  const countCallback = useRef(onCountChange);
  countCallback.current = onCountChange;
  useEffect(() => { if (!loading && pendingDeletes === 0) countCallback.current?.(items.length); }, [items.length, loading, pendingDeletes]);
  useEffect(() => {
    if (initial !== undefined) { setItems(initial); setLoading(false); return; }
    const controller = new AbortController();
    fetch(`/api/attachments?${query}`, { signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error("Couldn't load files."); return res.json(); })
      .then((body: { attachments: AttachmentData[] }) => setItems(body.attachments))
      .catch(() => { if (!controller.signal.aborted) setError("Couldn't load files."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, initial]);

  async function upload(files: File[]) {
    if (busy.current || loading) return;
    busy.current = true;
    setError(null);
    const errors: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        setProgress(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
        try {
          const attachment = await uploadAttachment(owner, file);
          setItems((prev) => [attachment, ...prev]);
          haptic("tick");
        } catch (e) {
          errors.push(`${file.name}: ${e instanceof Error ? e.message : "Upload failed."}`);
        }
      }
      if (errors.length) setError(errors.join(" "));
    } finally { busy.current = false; setProgress(null); }
  }

  async function remove(item: AttachmentData) {
    setError(null);
    setPendingDeletes((n) => n + 1);
    const index = items.findIndex((a) => a.id === item.id);
    setItems((prev) => prev.filter((a) => a.id !== item.id));
    try {
      const res = await fetch(`/api/attachments/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't delete file.");
    } catch {
      setItems((prev) => { const next = [...prev]; next.splice(index, 0, item); return next; });
      setError("Couldn't delete file.");
    } finally { setPendingDeletes((n) => n - 1); }
  }

  return <AttachmentDropZone onFiles={upload} disabled={loading || !!progress}>
    {error ? <div role="alert" className="mb-2 text-[12px] text-rose-500">{error}</div> : null}
    {progress || loading ? <div role="status" className="flex items-center gap-1.5 py-1 text-[12px] text-[var(--color-muted-foreground)]"><Loader2 className="size-3.5 shrink-0 animate-spin" />{progress ?? "loading…"}</div> : null}
    {!loading && items.length === 0 ? <div className="py-1 text-[12px] text-[var(--color-muted-foreground)]/70">No files yet. Drop files here to upload.</div> : null}
    <ul className="space-y-1">
      {items.map((a) => {
        const Icon = a.mimeType?.startsWith("image/") ? ImageIcon : a.mimeType === "application/pdf" ? FileText : Paperclip;
        return <li key={a.id} className="group flex items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5 text-sm hover:text-[var(--color-tint)]">
            <span className="truncate">{a.title}</span>
            {a.size !== null ? <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]">{formatAttachmentSize(a.size)}</span> : null}
            <ExternalLink className="size-3 shrink-0 text-[var(--color-muted-foreground)]/50" />
          </a>
          <button type="button" onClick={() => remove(a)} className="grid size-6 shrink-0 place-items-center rounded text-[var(--color-muted-foreground)]/40 transition hover:bg-rose-500/10 hover:text-rose-500 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${a.title}`}><Trash2 className="size-3.5" /></button>
        </li>;
      })}
    </ul>
  </AttachmentDropZone>;
}
