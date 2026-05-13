"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { SimpleMarkdown } from "./simple-markdown";

type Turn = { role: "user" | "assistant"; content: string };

export function ProjectChat({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, open, pending]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || pending) return;
    setQuestion("");
    setError(null);
    const history: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(history);
    setPending(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: turns }),
      });
      if (!res.ok) {
        const { error: msg } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(msg ?? `request failed (${res.status})`);
      }
      const { answer } = (await res.json()) as { answer: string };
      setTurns([...history, { role: "assistant", content: answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed right-4 z-40 grid place-items-center size-12 rounded-full bg-violet-500 text-white shadow-lg hover:bg-violet-600 transition bottom-[calc(env(safe-area-inset-bottom)+64px+1rem)] md:bottom-6 md:right-6"
        title={open ? "Close chat" : `Ask about ${projectName}`}
      >
        {open ? <X className="size-5" /> : <MessageCircle className="size-5" />}
      </button>

      {open ? (
        <div className="fixed inset-0 z-40 md:inset-auto md:bottom-24 md:right-6 md:w-[min(92vw,400px)] md:h-[min(70vh,560px)] md:rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl flex flex-col overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:pt-0 md:pb-0">
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
            <MessageCircle className="size-4 text-violet-400" />
            <div className="text-sm font-semibold truncate">
              Ask about {projectName}
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {turns.length === 0 && !pending ? (
              <div className="text-sm text-[var(--color-muted-foreground)]">
                Ask anything about this project — the assistant has read access
                to the dashboard, todos, notes, and history.
              </div>
            ) : null}
            {turns.map((t, i) => (
              <div key={i}>
                {t.role === "user" ? (
                  <div className="text-sm">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] mb-0.5">
                      You
                    </div>
                    <div>{t.content}</div>
                  </div>
                ) : (
                  <div className="text-sm">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-400 mb-0.5">
                      Claude
                    </div>
                    <div className="rounded-lg bg-[var(--color-accent)]/40 px-3 py-2">
                      <SimpleMarkdown text={t.content} />
                    </div>
                  </div>
                )}
              </div>
            ))}
            {pending ? (
              <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                <Loader2 className="size-3 animate-spin" /> Thinking…
              </div>
            ) : null}
            {error ? (
              <div className="text-xs text-rose-500">{error}</div>
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
              placeholder="Ask anything…"
              disabled={pending}
              className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:outline-none focus:border-[var(--color-ring)] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!question.trim() || pending}
              className="rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
