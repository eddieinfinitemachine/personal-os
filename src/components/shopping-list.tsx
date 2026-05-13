"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ShoppingData = {
  id: string;
  title: string;
  link: string | null;
  priceUsd: number | null;
  quantity: number | null;
  notes: string | null;
  completedAt: Date | string | null;
};

export function ShoppingList({
  apiBase,
  items,
}: {
  apiBase: string; // e.g. "/api/vehicles/<id>" or "/api/pets/<id>"
  items: ShoppingData[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [pendingItems, setPendingItems] = useState<ShoppingData[]>([]);
  const [completionOverrides, setCompletionOverrides] = useState<
    Map<string, Date | null>
  >(new Map());

  // Auto-prune when server catches up.
  useEffect(() => {
    setPendingItems((prev) => {
      const ids = new Set(items.map((i) => i.id));
      const next = prev.filter((p) => !ids.has(p.id));
      return next.length === prev.length ? prev : next;
    });
    setCompletionOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const [id, override] of prev) {
        const server = byId.get(id);
        if (!server) {
          next.delete(id);
          continue;
        }
        const serverDone = server.completedAt != null;
        const overrideDone = override != null;
        if (serverDone === overrideDone) next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const visibleItems = useMemo<ShoppingData[]>(() => {
    const merged = [...items, ...pendingItems];
    if (completionOverrides.size === 0) return merged;
    return merged.map((i) =>
      completionOverrides.has(i.id)
        ? { ...i, completedAt: completionOverrides.get(i.id) ?? null }
        : i
    );
  }, [items, pendingItems, completionOverrides]);

  const incomplete = visibleItems.filter((i) => i.completedAt == null);
  const complete = visibleItems.filter((i) => i.completedAt != null);

  // Add inline form
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [price, setPrice] = useState("");
  const [showExtras, setShowExtras] = useState(false);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempItem: ShoppingData = {
      id: tempId,
      title: trimmed,
      link: link.trim() || null,
      priceUsd: price ? Number(price.replace(/[^\d.]/g, "")) : null,
      quantity: 1,
      notes: null,
      completedAt: null,
    };
    setPendingItems((prev) => [...prev, tempItem]);
    setTitle("");
    setLink("");
    setPrice("");
    setShowExtras(false);

    try {
      const res = await fetch(`${apiBase}/shopping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          link: tempItem.link,
          priceUsd: tempItem.priceUsd,
        }),
      });
      if (res.ok) {
        const { item } = (await res.json()) as { item: ShoppingData };
        setPendingItems((prev) =>
          prev.map((p) => (p.id === tempId ? item : p))
        );
        startTransition(() => router.refresh());
      } else {
        setPendingItems((prev) => prev.filter((p) => p.id !== tempId));
      }
    } catch {
      setPendingItems((prev) => prev.filter((p) => p.id !== tempId));
    }
  }

  function toggleComplete(id: string) {
    const current = visibleItems.find((i) => i.id === id);
    if (!current) return;
    const next = current.completedAt ? null : new Date();
    setCompletionOverrides((prev) => {
      const map = new Map(prev);
      map.set(id, next);
      return map;
    });
    fetch(`${apiBase}/shopping/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggleComplete: true }),
    }).then((res) => {
      if (res.ok) startTransition(() => router.refresh());
    });
  }

  async function deleteItem(id: string) {
    const res = await fetch(`${apiBase}/shopping/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setPendingItems((prev) => prev.filter((p) => p.id !== id));
      startTransition(() => router.refresh());
    }
  }

  const incompleteTotal = incomplete.reduce(
    (sum, i) => sum + (i.priceUsd ?? 0) * (i.quantity ?? 1),
    0
  );

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <ShoppingBag className="size-4" /> Shopping list
        </h3>
        {incompleteTotal > 0 ? (
          <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
            ~${incompleteTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} pending
          </span>
        ) : null}
      </div>

      <ul className="space-y-px -mx-1">
        {incomplete.map((it) => (
          <ShoppingRow
            key={it.id}
            item={it}
            onToggle={() => toggleComplete(it.id)}
            onDelete={() => deleteItem(it.id)}
          />
        ))}
      </ul>

      <form onSubmit={addItem} className="mt-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="size-[18px] shrink-0 rounded-full border-2 border-[var(--color-muted-foreground)]/40" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add item to buy…"
            className="flex-1 bg-transparent text-[15px] focus:outline-none placeholder:text-[var(--color-muted-foreground)]/70"
          />
          <button
            type="button"
            onClick={() => setShowExtras((v) => !v)}
            className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            {showExtras ? "Less" : "Link/Price"}
          </button>
        </div>
        {showExtras ? (
          <div className="flex gap-2 pl-7">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://… (optional)"
              className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--color-ring)]"
            />
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="$"
              className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--color-ring)]"
            />
          </div>
        ) : null}
      </form>

      {complete.length > 0 ? (
        <details className="mt-4">
          <summary className="text-xs text-[var(--color-muted-foreground)] cursor-pointer hover:text-[var(--color-foreground)]">
            {complete.length} bought
          </summary>
          <ul className="mt-2 space-y-px -mx-1">
            {complete.map((it) => (
              <ShoppingRow
                key={it.id}
                item={it}
                onToggle={() => toggleComplete(it.id)}
                onDelete={() => deleteItem(it.id)}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function ShoppingRow({
  item,
  onToggle,
  onDelete,
}: {
  item: ShoppingData;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const completed = item.completedAt != null;
  return (
    <li className="group flex items-start gap-3 px-1 py-2 rounded-lg hover:bg-[var(--color-accent)]/40 transition">
      <button
        onClick={onToggle}
        className={cn(
          "mt-0.5 ml-1 grid size-[18px] shrink-0 place-items-center rounded-full border-2 transition",
          completed
            ? "bg-emerald-500 border-emerald-500 text-white"
            : "border-[var(--color-muted-foreground)]/40 hover:border-emerald-500"
        )}
        title={completed ? "Mark unbought" : "Mark bought"}
      >
        {completed ? <Check className="size-2.5" strokeWidth={3.5} /> : null}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "text-sm leading-snug truncate",
            completed && "line-through text-[var(--color-muted-foreground)]"
          )}
        >
          {item.title}
          {item.priceUsd != null ? (
            <span className="ml-2 text-xs text-[var(--color-muted-foreground)] tabular-nums font-normal">
              ${item.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          ) : null}
        </div>
      </div>
      {item.link ? (
        <a
          href={item.link}
          target="_blank"
          rel="noreferrer"
          className="rounded p-1 text-[var(--color-muted-foreground)] opacity-50 md:opacity-0 md:group-hover:opacity-100 hover:text-[var(--color-foreground)] transition"
          title="Open link"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
      <button
        onClick={onDelete}
        className="rounded p-1 text-[var(--color-muted-foreground)] opacity-50 md:opacity-0 md:group-hover:opacity-100 hover:text-rose-500 transition"
        title="Delete"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}
