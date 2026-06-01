"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2, Paperclip, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptic";
import { linkify } from "@/lib/linkify";

// Things-style detail modal for a single todo. Double-click a todo to open.
// Edits to notes auto-save on blur. Subtasks: add (Enter), toggle complete,
// delete (X). Files: upload (attachment) or open/delete. Close with Esc, the X
// button, or click outside.

export type DetailSubtask = {
  id: string;
  title: string;
  completedAt: string | Date | null;
};

type DetailAttachment = {
  id: string;
  kind: string;
  title: string;
  url: string;
  mimeType: string | null;
  size: number | null;
};

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function TodoDetailModal({
  open,
  todoId,
  initialTitle,
  initialNotes,
  initialSubtasks,
  onClose,
}: {
  open: boolean;
  todoId: string;
  initialTitle: string;
  initialNotes: string | null;
  initialSubtasks: DetailSubtask[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [subtasks, setSubtasks] = useState<DetailSubtask[]>(initialSubtasks);
  const [newSubtask, setNewSubtask] = useState("");
  const [addingPending, setAddingPending] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [attachments, setAttachments] = useState<DetailAttachment[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const newSubRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Single refresh on close keeps the parent list in sync without
  // re-rendering after every optimistic op while the modal is open.
  const needsRefreshRef = useRef(false);

  function closeModal() {
    if (needsRefreshRef.current) {
      needsRefreshRef.current = false;
      needsRefreshRef.current = true;
    }
    onClose();
  }

  // Re-hydrate only when the underlying todo identity changes. Without this,
  // any parent re-render passes a new inline subtasks array reference and
  // clobbers in-progress local edits (notes textarea, half-typed subtask).
  useEffect(() => {
    if (open) {
      setNotes(initialNotes ?? "");
      setSubtasks(initialSubtasks);
      setNewSubtask("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, todoId]);

  // Load this todo's attachments when the modal opens (or the todo changes).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFileError(null);
    setAttachments([]);
    setLoadingFiles(true);
    fetch(`/api/attachments?todoId=${encodeURIComponent(todoId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((body: { attachments: DetailAttachment[] }) => {
        if (!cancelled) setAttachments(body.attachments ?? []);
      })
      .catch(() => {
        if (!cancelled) setFileError("Couldn't load files.");
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, todoId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function saveNotes(next: string) {
    if ((initialNotes ?? "") === next) return;
    setSavingNotes(true);
    try {
      await fetch(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: next || null }),
      });
      needsRefreshRef.current = true;
    } finally {
      setSavingNotes(false);
    }
  }

  async function addSubtask() {
    const t = newSubtask.trim();
    if (!t || addingPending) return;
    setAddingPending(true);
    // Optimistic — paint immediately.
    const tempId = `temp-${Date.now()}`;
    setSubtasks((prev) => [...prev, { id: tempId, title: t, completedAt: null }]);
    setNewSubtask("");
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, parentId: todoId }),
      });
      if (res.ok) {
        const body = (await res.json()) as { todo: { id: string; title: string } };
        setSubtasks((prev) =>
          prev.map((s) =>
            s.id === tempId
              ? { id: body.todo.id, title: body.todo.title, completedAt: null }
              : s,
          ),
        );
        haptic("tick");
        needsRefreshRef.current = true;
      } else {
        // Rollback.
        setSubtasks((prev) => prev.filter((s) => s.id !== tempId));
      }
    } catch {
      setSubtasks((prev) => prev.filter((s) => s.id !== tempId));
    } finally {
      setAddingPending(false);
      // Keep the input focused for rapid entry.
      newSubRef.current?.focus();
    }
  }

  async function toggleSubtask(id: string) {
    const cur = subtasks.find((s) => s.id === id);
    if (!cur) return;
    const wasComplete = !!cur.completedAt;
    // Optimistic.
    setSubtasks((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, completedAt: wasComplete ? null : new Date() } : s,
      ),
    );
    haptic("tick");
    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggleComplete: true }),
      });
      if (!res.ok) {
        setSubtasks((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, completedAt: wasComplete ? new Date() : null } : s,
          ),
        );
        return;
      }
      needsRefreshRef.current = true;
    } catch {
      // Rollback.
      setSubtasks((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, completedAt: wasComplete ? new Date() : null } : s,
        ),
      );
    }
  }

  async function deleteSubtask(id: string) {
    const before = subtasks;
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
    try {
      const res = await fetch(`/api/todos/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setSubtasks(before);
        return;
      }
      needsRefreshRef.current = true;
    } catch {
      setSubtasks(before);
    }
  }

  async function uploadFile(file: File) {
    if (uploading) return;
    setFileError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("todoId", todoId);
      form.append("file", file);
      const res = await fetch("/api/attachments/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setFileError(body?.error || "Upload failed.");
        return;
      }
      const body = (await res.json()) as { attachment: DetailAttachment };
      setAttachments((prev) => [body.attachment, ...prev]);
      haptic("tick");
      needsRefreshRef.current = true;
    } catch {
      setFileError("Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deleteAttachment(id: string) {
    const before = attachments;
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    try {
      const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setAttachments(before);
        return;
      }
      needsRefreshRef.current = true;
    } catch {
      setAttachments(before);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Todo
            </div>
            <div className="mt-0.5 break-words text-base font-medium">
              {linkify(initialTitle, (e) => e.stopPropagation())}
            </div>
          </div>
          <button
            onClick={closeModal}
            className="grid size-7 shrink-0 place-items-center rounded-md text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Notes */}
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Notes
            </div>
            {savingNotes ? (
              <div className="flex items-center gap-1 text-[11px] text-[var(--color-muted-foreground)]">
                <Loader2 className="size-3 animate-spin" /> saving
              </div>
            ) : null}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => saveNotes(notes)}
            placeholder="Notes, links, context…"
            rows={3}
            className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none"
          />
        </div>

        {/* Files */}
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Files
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-tint)] hover:opacity-80 disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Upload className="size-3" />
              )}
              {uploading ? "uploading" : "Add file"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadFile(file);
              }}
            />
          </div>
          {fileError ? (
            <div className="mb-2 text-[12px] text-rose-500">{fileError}</div>
          ) : null}
          {loadingFiles ? (
            <div className="flex items-center gap-1.5 py-1 text-[12px] text-[var(--color-muted-foreground)]">
              <Loader2 className="size-3.5 animate-spin" /> loading…
            </div>
          ) : attachments.length === 0 ? (
            <div className="py-1 text-[12px] text-[var(--color-muted-foreground)]/70">
              No files yet.
            </div>
          ) : (
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li key={a.id} className="group flex items-center gap-2">
                  <Paperclip className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-sm hover:text-[var(--color-tint)]"
                  >
                    <span className="truncate">{a.title}</span>
                    {a.size ? (
                      <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]">
                        {formatBytes(a.size)}
                      </span>
                    ) : null}
                    <ExternalLink className="size-3 shrink-0 text-[var(--color-muted-foreground)]/50" />
                  </a>
                  <button
                    onClick={() => deleteAttachment(a.id)}
                    className="grid size-6 shrink-0 place-items-center rounded text-[var(--color-muted-foreground)]/40 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-500 group-hover:opacity-100"
                    aria-label="Delete file"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Subtasks */}
        <div className="px-5 py-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Subtasks
          </div>
          <ul className="space-y-1.5">
            {subtasks.map((s) => {
              const done = !!s.completedAt;
              return (
                <li key={s.id} className="group flex items-center gap-2">
                  <button
                    onClick={() => toggleSubtask(s.id)}
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full border-2 transition",
                      done
                        ? "border-[var(--color-tint)] bg-[var(--color-tint)] text-white"
                        : "border-[var(--color-border)] hover:border-[var(--color-tint)]",
                    )}
                    aria-label={done ? "Mark incomplete" : "Mark complete"}
                  >
                    {done ? <Check className="size-3" strokeWidth={3} /> : null}
                  </button>
                  <span
                    className={cn(
                      "flex-1 text-sm",
                      done && "text-[var(--color-muted-foreground)] line-through",
                    )}
                  >
                    {linkify(s.title)}
                  </span>
                  <button
                    onClick={() => deleteSubtask(s.id)}
                    className="grid size-6 shrink-0 place-items-center rounded text-[var(--color-muted-foreground)]/40 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-500 group-hover:opacity-100"
                    aria-label="Delete subtask"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              );
            })}
            <li className="flex items-center gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-dashed border-[var(--color-border)]" />
              <input
                ref={newSubRef}
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSubtask();
                  }
                }}
                placeholder="Add a subtask…"
                className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-[var(--color-muted-foreground)]/70"
              />
              {addingPending ? (
                <Loader2 className="size-3.5 animate-spin text-[var(--color-muted-foreground)]" />
              ) : null}
            </li>
          </ul>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <span className="text-[11px] text-[var(--color-muted-foreground)]">
            <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono">esc</kbd>{" "}
            to close
          </span>
          <button
            onClick={closeModal}
            className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
