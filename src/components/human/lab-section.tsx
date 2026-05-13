"use client";

import { useMemo, useState } from "react";
import { Beaker } from "lucide-react";
import { LabGrid, type LabRow } from "./lab-grid";
import { LabTrends, type MarkerSeries } from "./lab-trends";
import { cn } from "@/lib/utils";

export function LabSection({
  drawDates,
  labsByDraw,
  marqueeSeries,
}: {
  drawDates: string[];
  labsByDraw: Record<string, LabRow[]>;
  marqueeSeries: MarkerSeries[];
}) {
  const sorted = useMemo(() => [...drawDates].sort(), [drawDates]);
  const latest = sorted[sorted.length - 1];
  const [selected, setSelected] = useState<string>(latest);

  const labs = labsByDraw[selected] ?? [];
  const priorIdx = sorted.indexOf(selected) - 1;
  const priorDraw = priorIdx >= 0 ? labsByDraw[sorted[priorIdx]] ?? [] : [];
  const priorByMarker = useMemo(() => {
    const m = new Map<string, LabRow>();
    for (const r of priorDraw) m.set(r.marker, r);
    return m;
  }, [priorDraw]);

  return (
    <>
      {marqueeSeries.length > 0 ? (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Beaker className="size-4" /> Marker trends
            <span className="text-xs text-[var(--color-muted-foreground)] font-normal">
              {sorted[0]} → {latest}
            </span>
          </h3>
          <LabTrends series={marqueeSeries} />
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold flex items-center gap-2">
            <Beaker className="size-4" /> Lab work
          </h3>
          <div className="flex flex-wrap items-center gap-1">
            {sorted.map((date) => (
              <button
                key={date}
                onClick={() => setSelected(date)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition tabular-nums",
                  selected === date
                    ? "bg-[var(--color-foreground)] text-[var(--color-background)]"
                    : "bg-[var(--color-accent)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                )}
              >
                {date}
                {date === latest ? (
                  <span className="ml-1 text-[9px] uppercase opacity-70">latest</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
        <LabGrid labs={labs} priorByMarker={priorByMarker} />
      </section>
    </>
  );
}
