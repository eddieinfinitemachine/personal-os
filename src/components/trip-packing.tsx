"use client";

import { useMemo, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Luggage,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SimpleMarkdown } from "./simple-markdown";

export type PackingItemRow = {
  id: string;
  title: string;
  category: string;
  quantity: number;
  notes: string | null;
  packedAt: string | null;
};

type Turn = {
  role: "user" | "assistant";
  content: string;
  applied?: string[];
};

// Canonical display order; unknown categories sort after these, alphabetically.
const CATEGORY_ORDER = [
  "Clothing",
  "Toiletries",
  "Electronics",
  "Documents",
  "Gear",
  "Health",
  "Other",
];

function categoryRank(c: string): number {
  const i = CATEGORY_ORDER.indexOf(c);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

export function TripPacking({
  tripId,
  initialItems,
  packingContext,
}: {
  tripId: string;
  initialItems: PackingItemRow[];
  packingContext: string | null;
}) {
  const [items, setItems] = useState<PackingItemRow[]>(initialItems);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [contextDraft, setContextDraft] = useState(packingContext ?? "");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const [addDraft, setAddDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, PackingItemRow[]>();
    for (const it of items) {
      const arr = map.get(it.category) ?? [];
      arr.push(it);
      map.set(it.category, arr);
    }
    return [...map.entries()].sort(
      (a, b) =>
        categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0])
    );
  }, [items]);
  const packedCount = items.filter((i) => i.packedAt).length;

  async function generate() {
    if (generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/packing/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: contextDraft.trim() }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(error ?? `request failed (${res.status})`);
      }
      const data = (await res.json()) as { items: PackingItemRow[] };
      setItems(data.items);
      setGenerateOpen(false);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function toggle(item: PackingItemRow) {
    const next = item.packedAt ? null : new Date().toISOString();
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, packedAt: next } : i))
    );
    await fetch(`/api/trips/${tripId}/packing/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ togglePacked: true }),
    });
  }

  async function remove(item: PackingItemRow) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await fetch(`/api/trips/${tripId}/packing/${item.id}`, {
      method: "DELETE",
    });
  }

  async function addItem() {
    const title = addDraft.trim();
    if (!title || adding) return;
    setAdding(true);
    const res = await fetch(`/api/trips/${tripId}/packing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setAdding(false);
    if (res.ok) {
      const { item } = (await res.json()) as { item: PackingItemRow };
      setItems((prev) => [...prev, item]);
      setAddDraft("");
    }
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || chatPending) return;
    setQuestion("");
    setChatError(null);
    const history: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(history);
    setChatPending(true);
    queueMicrotask(() =>
      chatScrollRef.current?.scrollTo({
        top: chatScrollRef.current.scrollHeight,
      })
    );
    try {
      const res = await fetch(`/api/trips/${tripId}/packing/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          // Strip UI-only fields — the API forwards history to Claude as-is.
          history: turns.map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(error ?? `request failed (${res.status})`);
      }
      const data = (await res.json()) as {
        answer: string;
        applied?: string[];
        items: PackingItemRow[];
      };
      setTurns([
        ...history,
        { role: "assistant", content: data.answer, applied: data.applied },
      ]);
      setItems(data.items);
      queueMicrotask(() =>
        chatScrollRef.current?.scrollTo({
          top: chatScrollRef.current.scrollHeight,
        })
      );
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "request failed");
    } finally {
      setChatPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 min-w-0">
          <Luggage className="size-4 text-[var(--color-muted-foreground)]" />
          <h2 className="text-sm font-semibold tracking-tight">Packing</h2>
          {items.length > 0 ? (
            <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
              {packedCount}/{items.length} packed
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {items.length > 0 ? (
            <button
              onClick={() => {
                setChatOpen((v) => !v);
                setGenerateOpen(false);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-accent)]/40 transition",
                chatOpen && "bg-[var(--color-accent)]/60"
              )}
            >
              <MessageCircle className="size-3.5" /> Tune with AI
            </button>
          ) : null}
          <button
            onClick={() => {
              setGenerateOpen((v) => !v);
              setChatOpen(false);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-accent)]/40 transition",
              generateOpen && "bg-[var(--color-accent)]/60"
            )}
          >
            <Sparkles className="size-3.5" />
            {items.length > 0 ? "Regenerate" : "Generate list"}
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="h-1 bg-[var(--color-accent)]/40">
          <div
            className="h-full bg-[var(--color-foreground)]/70 transition-all"
            style={{ width: `${(packedCount / items.length) * 100}%` }}
          />
        </div>
      ) : null}

      {generateOpen ? (
        <div className="px-4 py-3 border-b border-[var(--color-border)] space-y-2">
          <label className="block text-xs font-medium text-[var(--color-muted-foreground)]">
            What are you doing on this trip?
          </label>
          <textarea
            value={contextDraft}
            onChange={(e) => setContextDraft(e.target.value)}
            rows={3}
            autoFocus
            placeholder="e.g. Skiing three days, one nice dinner out, hotel has a pool and gym. Carry-on only."
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none resize-y"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => void generate()}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {generating ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Checking weather
                  &amp; building list…
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  {items.length > 0 ? "Add what's missing" : "Generate"}
                </>
              )}
            </button>
            <button
              onClick={() => setGenerateOpen(false)}
              className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              Cancel
            </button>
          </div>
          {items.length > 0 ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Regenerating only adds items you don&rsquo;t already have — nothing
              gets removed or unchecked.
            </p>
          ) : null}
          {generateError ? (
            <p className="text-xs text-rose-500">{generateError}</p>
          ) : null}
        </div>
      ) : null}

      {items.length === 0 && !generateOpen ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)] mb-3">
            No packing list yet. Tell EC what you&rsquo;re doing and it&rsquo;ll
            build one from the weather and your plans.
          </p>
          <button
            onClick={() => setGenerateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium"
          >
            <Sparkles className="size-3.5" /> Generate packing list
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="p-4 space-y-4">
          {grouped.map(([category, list]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  {category}
                </h3>
                <span className="text-[11px] text-[var(--color-muted-foreground)] tabular-nums">
                  {list.filter((i) => i.packedAt).length}/{list.length}
                </span>
              </div>
              <ul className="space-y-px -mx-1">
                {list.map((it) => {
                  const packed = !!it.packedAt;
                  return (
                    <li
                      key={it.id}
                      className="group flex items-start gap-3 px-1 py-1.5 rounded hover:bg-[var(--color-accent)]/40 transition"
                    >
                      <button
                        onClick={() => void toggle(it)}
                        className={cn(
                          "mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full border-2 transition",
                          packed
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "border-[var(--color-muted-foreground)]/40 hover:border-emerald-500"
                        )}
                        title={packed ? "Mark unpacked" : "Mark packed"}
                      >
                        {packed ? <Check className="size-3" /> : null}
                      </button>
                      <div
                        className={cn(
                          "flex-1 min-w-0 text-sm",
                          packed &&
                            "line-through text-[var(--color-muted-foreground)]"
                        )}
                      >
                        {it.title}
                        {it.quantity > 1 ? (
                          <span className="ml-1.5 text-xs text-[var(--color-muted-foreground)] tabular-nums">
                            ×{it.quantity}
                          </span>
                        ) : null}
                        {it.notes ? (
                          <div className="text-xs text-[var(--color-muted-foreground)] line-clamp-1">
                            {it.notes}
                          </div>
                        ) : null}
                      </div>
                      <button
                        onClick={() => void remove(it)}
                        className="opacity-0 group-hover:opacity-100 text-[var(--color-muted-foreground)] hover:text-rose-500 transition p-0.5"
                        title="Delete item"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addItem();
            }}
            className="flex items-center gap-2 pt-1"
          >
            <input
              value={addDraft}
              onChange={(e) => setAddDraft(e.target.value)}
              placeholder="Add an item…"
              className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none min-h-[40px]"
            />
            <button
              type="submit"
              disabled={adding || !addDraft.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50 min-h-[36px]"
            >
              {adding ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Add
            </button>
          </form>
        </div>
      ) : null}

      {chatOpen ? (
        <div className="border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wider">
              Tune with AI
            </div>
            <button
              onClick={() => setChatOpen(false)}
              className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] p-0.5"
              title="Close"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div
            ref={chatScrollRef}
            className="max-h-72 overflow-y-auto px-4 pb-3 space-y-3"
          >
            {turns.length === 0 && !chatPending ? (
              <div className="text-sm text-[var(--color-muted-foreground)]">
                Ask for changes in plain language — &ldquo;carry-on only, trim it
                down&rdquo;, &ldquo;add gym stuff&rdquo;, &ldquo;it&rsquo;s going
                to be colder than expected&rdquo;.
              </div>
            ) : null}
            {turns.map((t, i) => (
              <div key={i} className="text-sm">
                {t.role === "user" ? (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] mb-0.5">
                      You
                    </div>
                    <div>{t.content}</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] mb-0.5">
                      EC
                    </div>
                    <div className="rounded-lg bg-[var(--color-accent)]/40 px-3 py-2">
                      <SimpleMarkdown text={t.content} />
                    </div>
                    {t.applied && t.applied.length > 0 ? (
                      <ul className="mt-1.5 space-y-0.5">
                        {t.applied.map((line, j) => (
                          <li
                            key={j}
                            className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
                          >
                            <Check className="size-3 shrink-0" /> {line}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
            {chatPending ? (
              <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                <Loader2 className="size-3 animate-spin" /> Thinking…
              </div>
            ) : null}
            {chatError ? (
              <div className="text-xs text-rose-500">{chatError}</div>
            ) : null}
          </div>
          <form
            onSubmit={ask}
            className="border-t border-[var(--color-border)] p-2 flex items-center gap-2"
          >
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Tweak the list…"
              disabled={chatPending}
              className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:outline-none focus:border-[var(--color-ring)] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!question.trim() || chatPending}
              className="rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {chatPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
