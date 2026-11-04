"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Compass, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { labDate } from "@/lib/health/lab-value";
import type { EvidenceRow, HealthPicture } from "@/lib/health/picture";

type Evidence = Record<string, EvidenceRow>;

function EvidenceLine({ row }: { row: EvidenceRow }) {
  return (
    <div className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
      <span className="font-medium text-[var(--color-foreground)]">{row.marker}</span>{" "}
      {row.points.map((p) => p.shown).join(" → ")} {row.unit}
      {row.range ? ` (range ${row.range})` : ""}
    </div>
  );
}

function Disclosure({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details className="group border-t border-[var(--color-border)] pt-3">
      <summary className="cursor-pointer text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
        {title}
      </summary>
      <ul className="mt-2 space-y-1 text-sm text-[var(--color-muted-foreground)]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

export function PictureBody({ picture, evidence }: { picture: HealthPicture; evidence: Evidence }) {
  return (
    <div className="space-y-4">
      <p className="text-[15px] leading-relaxed">{picture.headline}</p>

      <ol className="space-y-4">
        {picture.focus.map((area, index) => {
          const rows = area.markers.flatMap((marker) => (evidence[marker] ? [evidence[marker]] : []));
          return (
            <li key={area.title} className="flex gap-3 border-t border-[var(--color-border)] pt-4">
              <span className="w-4 shrink-0 text-sm font-semibold tabular-nums text-[var(--color-muted-foreground)]">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold">{area.title}</h4>
                  {area.kind === "hypothesis" ? (
                    <span className="rounded-md bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      Hypothesis
                    </span>
                  ) : null}
                </div>
                <p className="text-sm leading-relaxed">{area.why}</p>
                {rows.length > 0 ? (
                  <div className="space-y-0.5">
                    {rows.map((row) => (
                      <EvidenceLine key={row.marker} row={row} />
                    ))}
                  </div>
                ) : null}
                <p className="text-sm leading-relaxed">
                  <span className="font-medium">Next:</span> {area.next}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <Disclosure title="Doesn't need your attention" items={picture.clear} />
      <Disclosure title="What it can't see yet" items={picture.blindSpots} />

      <p className="border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-muted-foreground)]">
        Written by AI from {picture.basedOn.draws} lab {picture.basedOn.draws === 1 ? "draw" : "draws"}
        {picture.basedOn.latestDraw ? ` through ${labDate(picture.basedOn.latestDraw)}` : ""}. Use it to guide a
        conversation with your doctor; it isn&apos;t a diagnosis.
      </p>
    </div>
  );
}

export function HealthPictureCard({
  projectId,
  initial,
  initialEvidence,
  stale,
}: {
  projectId: string;
  initial: HealthPicture | null;
  initialEvidence: Evidence;
  stale: boolean;
}) {
  const [picture, setPicture] = useState(initial);
  const [evidence, setEvidence] = useState(initialEvidence);
  const [working, setWorking] = useState(stale);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(
    async (force: boolean) => {
      setWorking(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/projects/${projectId}/picture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { picture: HealthPicture | null; evidence: Evidence };
        if (body.picture) {
          setPicture(body.picture);
          setEvidence(body.evidence);
        }
      } catch {
        setFailed(true);
      } finally {
        setWorking(false);
      }
    },
    [projectId],
  );

  // New data updates the picture on its own, once per page view. The ref also
  // survives Strict Mode's double effect, so one view can't pay for two writes.
  const requested = useRef(false);
  useEffect(() => {
    if (!stale || requested.current) return;
    requested.current = true;
    void refresh(false);
  }, [stale, refresh]);

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold">
          <Compass className="size-4" /> The picture
        </h3>
        <div className="flex items-center gap-2">
          <span aria-live="polite" className="text-xs text-[var(--color-muted-foreground)]">
            {working
              ? picture
                ? "Updating…"
                : ""
              : failed
                ? picture
                  ? "Couldn't update. Showing the last version."
                  : ""
                : picture
                  ? `Updated ${labDate(picture.generatedAt)}`
                  : ""}
          </span>
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={working}
            aria-label="Refresh the picture"
            title="Refresh the picture"
            className="inline-flex size-8 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-muted-foreground)] transition hover:text-[var(--color-foreground)] disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", working && "animate-spin")} />
          </button>
        </div>
      </div>

      {picture ? (
        <PictureBody picture={picture} evidence={evidence} />
      ) : working ? (
        <div className="space-y-2" aria-label="Reading your data">
          <p className="text-sm text-[var(--color-muted-foreground)]">Reading your data. This can take a minute.</p>
          <div className="h-3 w-full animate-pulse rounded bg-[var(--color-muted)]" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-[var(--color-muted)]" />
        </div>
      ) : (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {failed ? "Couldn't write the picture just now. Try refreshing." : "Add lab results to see the picture."}
        </p>
      )}
    </section>
  );
}
