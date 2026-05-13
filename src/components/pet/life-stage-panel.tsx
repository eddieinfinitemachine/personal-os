"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { SimpleMarkdown } from "../simple-markdown";

export function LifeStagePanel({
  petId,
  initialNote,
  initialNoteAt,
}: {
  petId: string;
  initialNote: string | null;
  initialNoteAt: Date | string | null;
}) {
  const [note, setNote] = useState<string | null>(initialNote);
  const [noteAt, setNoteAt] = useState<Date | string | null>(initialNoteAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRanRef = useRef(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pets/${petId}/life-stage`, {
        method: "POST",
      });
      if (!res.ok) {
        const { error: msg } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(msg ?? `request failed (${res.status})`);
      }
      const { note: n, noteAt: t } = (await res.json()) as {
        note: string;
        noteAt: string;
      };
      setNote(n);
      setNoteAt(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialNote) return;
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold flex items-center gap-2 text-violet-400">
          <Sparkles className="size-4" /> What to expect
        </h3>
        <button
          onClick={generate}
          disabled={loading}
          className="text-xs text-violet-400 hover:text-violet-300 inline-flex items-center gap-1 disabled:opacity-50"
          title="Regenerate"
        >
          {loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          {loading ? "Thinking…" : note ? "Refresh" : "Generate"}
        </button>
      </div>

      {error ? (
        <div className="text-xs text-rose-500 mt-1">{error}</div>
      ) : null}

      {note ? (
        <>
          <SimpleMarkdown text={note} />
          {noteAt ? (
            <div className="text-[10px] text-[var(--color-muted-foreground)] mt-3">
              Generated {new Date(noteAt).toLocaleString()}
            </div>
          ) : null}
        </>
      ) : !loading && !error ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Generating breed + age-specific guidance…
        </p>
      ) : null}
    </section>
  );
}
