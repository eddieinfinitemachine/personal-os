"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type NoteData = {
  id: string;
  title: string | null;
  body: string;
  updatedAt: Date | string;
};

export function NotesPane({
  projectId,
  notes,
}: {
  projectId: string;
  notes: NoteData[];
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(notes[0]?.id ?? null);
  const [pending, startTransition] = useTransition();

  const active = notes.find((n) => n.id === activeId) ?? null;

  async function createNote() {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title: "Untitled", body: "" }),
    });
    if (res.ok) {
      const { note } = (await res.json()) as { note: NoteData };
      setActiveId(note.id);
      startTransition(() => router.refresh());
    }
  }

  async function deleteNote(id: string) {
    if (!confirm("Delete this note?")) return;
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (activeId === id) {
        const remaining = notes.filter((n) => n.id !== id);
        setActiveId(remaining[0]?.id ?? null);
      }
      startTransition(() => router.refresh());
    }
  }

  if (notes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-12 text-center">
        <FileText className="size-8 mx-auto mb-3 text-[var(--color-muted-foreground)]" />
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          No notes yet for this project.
        </p>
        <button
          onClick={createNote}
          className="rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
        >
          <Plus className="size-3.5" /> New note
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-[260px_1fr]">
      <aside className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] flex flex-col max-h-[600px]">
        <div className="px-3 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="text-sm font-semibold">Notes</h3>
          <button
            onClick={createNote}
            className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition"
            title="New note"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {notes.map((n) => {
            const isActive = n.id === activeId;
            const preview =
              n.body.split("\n").find((l) => l.trim().length > 0) ?? "";
            return (
              <li key={n.id}>
                <button
                  onClick={() => setActiveId(n.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 transition",
                    isActive
                      ? "bg-[var(--color-accent)]"
                      : "hover:bg-[var(--color-accent)]/50"
                  )}
                >
                  <div className="text-sm font-medium truncate">
                    {n.title || "Untitled"}
                  </div>
                  {preview ? (
                    <div className="text-xs text-[var(--color-muted-foreground)] truncate mt-0.5">
                      {preview}
                    </div>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      {active ? (
        <NoteEditor
          key={active.id}
          note={active}
          onDelete={() => deleteNote(active.id)}
          pending={pending}
        />
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-8 text-sm text-[var(--color-muted-foreground)] text-center">
          Select a note
        </div>
      )}
    </div>
  );
}

function NoteEditor({
  note,
  onDelete,
  pending,
}: {
  note: NoteData;
  onDelete: () => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState(note.title ?? "");
  const [body, setBody] = useState(note.body);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(false);

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setStatus("saving");
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (res.ok) {
        setStatus("saved");
        router.refresh();
      }
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [title, body, note.id, router]);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] flex flex-col min-h-[500px]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          className="flex-1 bg-transparent text-base font-semibold focus:outline-none"
        />
        <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums shrink-0">
          {pending || status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
        </span>
        <button
          onClick={onDelete}
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-red-500 transition"
          title="Delete note"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Start typing…"
        className="flex-1 bg-transparent px-4 py-3 text-sm leading-relaxed focus:outline-none resize-none font-mono"
      />
    </div>
  );
}
