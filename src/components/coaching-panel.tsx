"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Eye,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type RecommendationData = {
  id: string;
  title: string;
  body: string | null;
  priority: string;
  cadence: string | null;
  generatedAt: Date | string;
  completedAt: Date | string | null;
  dismissedAt: Date | string | null;
};

export function CoachingPanel({
  generateUrl,
  initialRecommendations,
}: {
  generateUrl: string; // e.g. "/api/pets/<id>/coach"
  initialRecommendations: RecommendationData[];
}) {
  const router = useRouter();
  const [recs, setRecs] = useState<RecommendationData[]>(initialRecommendations);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const autoRanRef = useRef(false);

  // Per-asset hidden preference, persisted to localStorage so the choice
  // sticks across reloads. Key includes the generateUrl which is unique per pet/vehicle.
  const storageKey = `coach-hidden:${generateUrl}`;
  const [hidden, setHidden] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(storageKey) === "1");
    } catch {
      // localStorage unavailable — default to visible.
    }
    setHydrated(true);
  }, [storageKey]);
  function setHiddenPersisted(v: boolean) {
    setHidden(v);
    try {
      if (v) localStorage.setItem(storageKey, "1");
      else localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(generateUrl, { method: "POST" });
      if (!res.ok) {
        const { error: msg } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(msg ?? `request failed (${res.status})`);
      }
      const { recommendations } = (await res.json()) as {
        recommendations: RecommendationData[];
      };
      setRecs(recommendations);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!hydrated) return;
    if (hidden) return; // honor the hide preference — don't burn a Claude call
    if (initialRecommendations.length > 0) return;
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, hidden]);

  async function complete(id: string) {
    // Optimistic
    setRecs((prev) => prev.filter((r) => r.id !== id));
    await fetch(`/api/recommendations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    startTransition(() => router.refresh());
  }

  async function dismiss(id: string) {
    setRecs((prev) => prev.filter((r) => r.id !== id));
    await fetch(`/api/recommendations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dismissed: true }),
    });
    startTransition(() => router.refresh());
  }

  if (hidden) {
    return (
      <button
        onClick={() => setHiddenPersisted(false)}
        className="inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] hover:text-violet-400 transition"
        title="Show coach"
      >
        <Eye className="size-3" /> Coach{recs.length > 0 ? ` (${recs.length})` : ""}
      </button>
    );
  }

  return (
    <section className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 to-violet-500/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2 text-violet-300">
          <Sparkles className="size-4" /> Coach — this week
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={generate}
            disabled={loading}
            className="text-xs text-violet-400 hover:text-violet-300 inline-flex items-center gap-1 disabled:opacity-50"
            title="Generate fresh suggestions"
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            {loading ? "Thinking…" : recs.length > 0 ? "Refresh" : "Generate"}
          </button>
          <button
            onClick={() => setHiddenPersisted(true)}
            className="text-xs text-violet-400/70 hover:text-violet-300 inline-flex items-center gap-1"
            title="Hide coach"
          >
            <ChevronDown className="size-3" /> Hide
          </button>
        </div>
      </div>

      {error ? (
        <div className="text-xs text-rose-500 mt-1">{error}</div>
      ) : null}

      {recs.length === 0 && !loading && !error ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          You&apos;re caught up — nothing pending.
        </p>
      ) : null}

      {recs.length === 0 && loading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Generating breed + season-aware suggestions…
        </p>
      ) : null}

      {recs.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {recs.map((r) => (
            <li
              key={r.id}
              className="group rounded-lg bg-violet-500/5 hover:bg-violet-500/10 p-3 flex items-baseline justify-between gap-3 transition"
              title={r.body ?? undefined}
            >
              <button
                onClick={() => complete(r.id)}
                className="flex-1 text-left text-sm font-medium leading-snug min-w-0 truncate hover:text-violet-300 transition"
              >
                {r.title}
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                {r.priority === "high" ? (
                  <span className="text-[10px] text-rose-400">High</span>
                ) : r.cadence && r.cadence !== "one-time" ? (
                  <span
                    className={cn(
                      "text-[10px]",
                      r.cadence === "weekly"
                        ? "text-cyan-400"
                        : r.cadence === "monthly"
                          ? "text-blue-400"
                          : "text-amber-400"
                    )}
                  >
                    {r.cadence}
                  </span>
                ) : null}
                <button
                  onClick={() => dismiss(r.id)}
                  className="rounded p-0.5 text-[var(--color-muted-foreground)]/60 opacity-50 md:opacity-0 md:group-hover:opacity-100 hover:text-rose-500 transition"
                  title="Dismiss"
                >
                  <X className="size-3" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
