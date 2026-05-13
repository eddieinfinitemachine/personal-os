"use client";

import { useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { SimpleMarkdown } from "../simple-markdown";

type Turn = {
  question: string;
  answer: string | null;
  error: string | null;
  pending: boolean;
};

export function BreedQA({
  petId,
  petName,
  breed,
}: {
  petId: string;
  petName: string;
  breed: string | null;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const placeholder = breed
    ? `Ask about ${breed}s — coat, temperament, health…`
    : `Ask about ${petName}…`;

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || submitting) return;
    setQuestion("");
    setSubmitting(true);

    const idx = turns.length;
    setTurns((prev) => [
      ...prev,
      { question: q, answer: null, error: null, pending: true },
    ]);

    try {
      const res = await fetch(`/api/pets/${petId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(error ?? `request failed (${res.status})`);
      }
      const { answer } = (await res.json()) as { answer: string };
      setTurns((prev) =>
        prev.map((t, i) =>
          i === idx ? { ...t, answer, pending: false } : t
        )
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "request failed";
      setTurns((prev) =>
        prev.map((t, i) =>
          i === idx ? { ...t, error: msg, pending: false } : t
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <MessageCircle className="size-4" /> Ask about {breed ?? petName}
      </h3>

      {turns.length > 0 ? (
        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1 mb-3">
          {turns.map((t, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-start gap-2">
                <div className="text-xs font-semibold text-[var(--color-muted-foreground)] shrink-0 w-8">
                  You
                </div>
                <div className="text-sm flex-1">{t.question}</div>
              </div>
              <div className="flex items-start gap-2">
                <div className="text-xs font-semibold text-violet-400 shrink-0 w-8">
                  Claude
                </div>
                <div className="flex-1 rounded-lg bg-[var(--color-accent)]/40 px-3 py-2">
                  {t.pending ? (
                    <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                      <Loader2 className="size-3 animate-spin" /> Thinking…
                    </div>
                  ) : t.error ? (
                    <div className="text-xs text-rose-500">{t.error}</div>
                  ) : t.answer ? (
                    <SimpleMarkdown text={t.answer} />
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <form onSubmit={ask} className="flex items-center gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={placeholder}
          disabled={submitting}
          className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:outline-none focus:border-[var(--color-ring)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!question.trim() || submitting}
          className="rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Ask
        </button>
      </form>
    </section>
  );
}
