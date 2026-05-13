"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type SidebarList = {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
};

export function MobileFab() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<SidebarList[]>([]);
  const [listId, setListId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || lists.length > 0) return;
    fetch("/api/lists")
      .then((r) => r.json())
      .then((d) => {
        const ls: SidebarList[] = d.lists ?? [];
        setLists(ls);
        if (!listId) {
          const def = ls.find((l) => l.isDefault) ?? ls[0];
          if (def) setListId(def.id);
        }
      })
      .catch(() => {});
  }, [open, lists.length, listId]);

  function close() {
    setOpen(false);
    setTitle("");
  }

  async function submit() {
    const t = title.trim();
    if (!t || !listId || saving) return;
    setSaving(true);
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t, listId }),
    });
    setSaving(false);
    if (res.ok) {
      setTitle("");
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Add todo"
        className="md:hidden fixed right-4 bottom-[calc(56px+env(safe-area-inset-bottom)+16px)] z-30 grid place-items-center size-14 rounded-full bg-[var(--color-tint)] text-white shadow-lg shadow-black/20 active:scale-95 transition"
      >
        <Plus className="size-6" strokeWidth={2.5} />
      </button>

      {open ? (
        <div
          className="md:hidden fixed inset-0 z-50 grid place-items-end bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-[var(--color-border)]">
              <div className="text-sm font-semibold">Quick add</div>
              <button
                onClick={close}
                aria-label="Close"
                className="rounded p-1 hover:bg-[var(--color-accent)]"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  } else if (e.key === "Escape") {
                    close();
                  }
                }}
                placeholder="What needs to happen?"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 text-base focus:border-[var(--color-ring)] focus:outline-none"
              />

              {lists.length > 0 ? (
                <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
                  {lists.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setListId(l.id)}
                      className={cn(
                        "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                        listId === l.id
                          ? "border-[var(--color-foreground)] bg-[var(--color-foreground)] text-[var(--color-background)]"
                          : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"
                      )}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)]">
              <button
                onClick={close}
                className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-accent)]"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={saving || !title.trim() || !listId}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-4 py-2 text-sm font-medium disabled:opacity-50 min-h-[40px]"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
