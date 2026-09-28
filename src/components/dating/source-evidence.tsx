"use client";
import { useState } from "react";
type Evidence = {
  id: string;
  source: string;
  title: string | null;
  url: string | null;
  quote: string;
  occurredAt: string | null;
};
export function SourceEvidence({ personId }: { personId: string }) {
  const [items, setItems] = useState<Evidence[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dating/${personId}/evidence`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.evidence)) throw Error();
      setItems(data.evidence);
    } catch {
      setError("Could not load source notes. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="my-5 rounded-xl border border-[var(--color-card-border)] p-4"
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">
        Source notes
      </summary>
      <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
        Original excerpts you approved or linked. Showing the latest 100.
      </p>
      {busy && (
        <p role="status" className="text-sm">
          Loading…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}{" "}
          <button className="min-h-11 underline" onClick={load}>
            Retry
          </button>
        </p>
      )}
      {!busy && items?.length === 0 && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          No linked source notes yet.
        </p>
      )}
      {!busy &&
        items?.map((e) => (
          <article
            key={e.id}
            className="border-t border-[var(--color-card-border)] py-3 text-sm"
          >
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {e.source === "ecpad"
                ? "EC Pad"
                : e.source === "texts"
                  ? "Texts"
                  : "Granola"}{" "}
              ·{" "}
              {e.occurredAt
                ? new Date(e.occurredAt).toLocaleDateString()
                : "Date unknown"}
              {e.title ? ` · ${e.title}` : ""}
            </p>
            <blockquote className="my-2 whitespace-pre-wrap break-words">
              {e.quote}
            </blockquote>
            {e.url?.startsWith("https://") && (
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center underline"
              >
                Open source
              </a>
            )}
          </article>
        ))}
    </details>
  );
}
