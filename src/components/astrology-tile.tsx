"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { SimpleMarkdown } from "./simple-markdown";

const COLLAPSE_KEY = "personalos:astrology:collapsed";

export function AstrologyTile() {
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const ranRef = useRef(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/personal/astrology", { method: "POST" });
      if (!res.ok) {
        const { error: msg } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(msg ?? `request failed (${res.status})`);
      }
      const { note: n } = (await res.json()) as { note: string };
      setNote(n);
      try {
        localStorage.setItem("personalos:astrology", n);
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    try {
      const cached = localStorage.getItem("personalos:astrology");
      if (cached) setNote(cached);
      const c = localStorage.getItem(COLLAPSE_KEY);
      if (c === "1") setCollapsed(true);
      if (cached) return;
    } catch {}
    if (ranRef.current) return;
    ranRef.current = true;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  return (
    <section className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-2 text-violet-400 font-semibold min-w-0"
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
          <Sparkles className="size-4 shrink-0" />
          <span className="truncate">Astrology · natal chart</span>
        </button>
        {!collapsed ? (
          <button
            onClick={generate}
            disabled={loading}
            className="text-xs text-violet-400 hover:text-violet-300 inline-flex items-center gap-1 disabled:opacity-50 shrink-0"
            title="Regenerate"
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            {loading ? "Casting…" : note ? "Refresh" : "Cast chart"}
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        <>
          {error ? <div className="text-xs text-rose-500 mt-1">{error}</div> : null}
          {note ? (
            <SimpleMarkdown text={note} />
          ) : !loading && !error ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Casting your natal chart…
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
